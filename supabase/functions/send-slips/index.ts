// Edge Function: kirim slip gaji lewat Email (Resend) dan/atau WhatsApp (Fonnte).
// Hanya admin yang login yang bisa memanggil. Memakai JWT pengguna (bukan service_role),
// jadi semua akses data tetap dibatasi RLS.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const rp = (n: number) => "Rp " + Math.round(Number(n)).toLocaleString("id-ID");
const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BATCH_SIZE = 15;

const PW_HINT = "Kata sandi PDF: tanggal lahir Anda dengan format DDMMYYYY (contoh: 05031990).";
const fname = (b: any, s: any) => `Slip-Gaji-${b.periode}-${s.nama}`.replace(/[^A-Za-z0-9._-]+/g, "_") + ".pdf";

// Nominal gaji TIDAK ditulis di badan pesan; hanya ada di dalam PDF berpassword.
function waText(b: any, s: any) {
  return [
    `*Slip Gaji ${b.periode}*`, b.perusahaan, "", `Yth. ${s.nama},`,
    "Slip gaji Anda terlampir dalam file PDF.", "", PW_HINT, "",
    "Dokumen ini rahasia. Hubungi HRD bila ada pertanyaan.",
  ].join("\n");
}

function emailHtml(b: any, s: any) {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#1b2a22">
<h2 style="margin:0">Slip Gaji ${esc(b.periode)}</h2><p style="margin:2px 0 14px;color:#667">${esc(b.perusahaan)}</p>
<p>Yth. ${esc(s.nama)},</p><p>Slip gaji Anda terlampir dalam file PDF.</p>
<p><b>${esc(PW_HINT)}</b></p>
<p style="color:#889;font-size:12px;margin-top:18px">Email ini bersifat rahasia. Jika bukan untuk Anda, hapus dan beri tahu HRD.</p></div>`;
}

async function sendEmail(sb: any, b: any, s: any) {
  if (!s.pdf_path) throw new Error("PDF belum dibuat");
  const { data, error } = await sb.storage.from("slips").download(s.pdf_path);
  if (error || !data) throw new Error("PDF tidak ditemukan");
  const content = encodeBase64(new Uint8Array(await data.arrayBuffer()));
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("FROM_EMAIL"), to: [s.email],
      subject: `Slip Gaji ${b.periode} - ${b.perusahaan}`, html: emailHtml(b, s),
      attachments: [{ filename: fname(b, s), content }],
    }),
  });
  if (!r.ok) throw new Error(`Email ditolak (HTTP ${r.status})`);
}

async function sendWa(sb: any, b: any, s: any) {
  if (!s.pdf_path) throw new Error("PDF belum dibuat");
  // Link sementara (15 menit) agar penyedia WA bisa mengambil file dari bucket private.
  const { data, error } = await sb.storage.from("slips").createSignedUrl(s.pdf_path, 900);
  if (error || !data) throw new Error("PDF tidak ditemukan");
  const r = await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: { Authorization: Deno.env.get("FONNTE_TOKEN")! },
    body: new URLSearchParams({ target: s.wa, message: waText(b, s), url: data.signedUrl, filename: fname(b, s) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status !== true) throw new Error(`WA ditolak: ${String(j.reason ?? r.status).slice(0, 100)}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "Belum login" }, 401);
    const { data: adm } = await sb.from("admins").select("user_id").maybeSingle();
    if (!adm) return json({ error: "Bukan admin" }, 403);

    const { batch_id, channel } = await req.json();
    if (!["email", "wa", "both"].includes(channel) || typeof batch_id !== "string")
      return json({ error: "Parameter tidak valid" }, 400);
    const doEmail = channel !== "wa", doWa = channel !== "email";

    const { data: batch } = await sb.from("batches").select("*").eq("id", batch_id).single();
    if (!batch) return json({ error: "Batch tidak ditemukan" }, 404);

    const pendingFilter = (q: any) =>
      channel === "email" ? q.eq("email_status", "pending")
      : channel === "wa" ? q.eq("wa_status", "pending")
      : q.or("email_status.eq.pending,wa_status.eq.pending");

    const { data: slips } = await pendingFilter(sb.from("slips").select("*").eq("batch_id", batch_id)).limit(BATCH_SIZE);
    let sent = 0, failed = 0;

    for (const s of slips ?? []) {
      const upd: Record<string, unknown> = {};
      if (doEmail && s.email_status === "pending") {
        if (!s.email) { upd.email_status = "skipped"; upd.email_error = "Tidak ada email"; }
        else try { await sendEmail(sb, batch, s); upd.email_status = "sent"; sent++; }
        catch (e) { upd.email_status = "failed"; upd.email_error = String(e.message).slice(0, 200); failed++; }
      }
      if (doWa && s.wa_status === "pending") {
        if (!s.wa) { upd.wa_status = "skipped"; upd.wa_error = "Tidak ada nomor WA"; }
        else try { await sendWa(sb, batch, s); upd.wa_status = "sent"; sent++; await sleep(1500); }
        catch (e) { upd.wa_status = "failed"; upd.wa_error = String(e.message).slice(0, 200); failed++; }
      }
      if (Object.keys(upd).length) {
        upd.sent_at = new Date().toISOString();
        await sb.from("slips").update(upd).eq("id", s.id);
      }
    }

    const { count } = await pendingFilter(
      sb.from("slips").select("id", { count: "exact", head: true }).eq("batch_id", batch_id),
    );
    return json({ processed: slips?.length ?? 0, sent, failed, remaining: count ?? 0 });
  } catch (e) {
    return json({ error: "Terjadi kesalahan server" }, 500);
  }
});
