# Kirim Slip Gaji (Email & WhatsApp)

Alur: login HRD → upload Excel → data tersimpan di Supabase → klik kirim → PDF dibuat di browser dan dikunci dengan password tanggal lahir → Email (Resend) / WA (Fonnte) terkirim otomatis dengan lampiran PDF.

## Struktur
```
index.html                              halaman admin (hosting GitHub Pages)
supabase/schema.sql                     tabel + Row Level Security
supabase/functions/send-slips/index.ts  fungsi pengirim (jalan di server Supabase)
.gitignore                              mencegah Excel/.env ikut ter-commit
```

## Langkah setup

### 1. Supabase
1. Buat project di supabase.com, pilih region **Singapore**.
2. **Authentication → Sign In / Providers**: matikan **Allow new users to sign up**.
3. **Authentication → Users → Add user**: buat akun HRD (email + sandi kuat).
4. **SQL Editor**: tempel isi `supabase/schema.sql`, klik Run. (Sudah pernah menjalankan versi lama? Jalankan hanya blok `TAMBAHAN PDF` di bagian bawah file.)
5. Jadikan akun HRD sebagai admin (ganti emailnya):
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'hrd@perusahaan.com';
   ```
6. Catat **Project URL** dan **anon key** (Settings → API). Jangan pakai `service_role` di mana pun.

### 2. Layanan pengirim
- **Email:** daftar di resend.com, verifikasi domain perusahaan, buat API key.
- **WhatsApp:** daftar di fonnte.com, sambungkan nomor pengirim, ambil token.
  (Fonnte tidak resmi dari Meta; ada risiko nomor diblokir. Pakai nomor khusus, jangan nomor utama.)

### 3. Deploy fungsi pengirim
Install Supabase CLI, lalu di folder ini:
```bash
supabase login
supabase link --project-ref hrlztsomibzpumpclauu
supabase secrets set RESEND_API_KEY=re_xxx FONNTE_TOKEN=xxx \
  FROM_EMAIL="Slip Gaji <slip@domainanda.com>" \
  ALLOWED_ORIGIN=https://nuranisawiji-payroll.github.io
supabase functions deploy send-slips
```
Biarkan "Verify JWT" tetap aktif (default).

### 4. Halaman web
1. URL proyek dan publishable key sudah terisi di `index.html` (URL harus tanpa `/rest/v1/`).
2. Buat repo GitHub, upload semua file, aktifkan **Settings → Pages** (branch main).
3. Buka alamat Pages Anda, login, dan **uji dulu dengan 1–2 karyawan (nomor/email Anda sendiri)**.

### Format Excel
Sheet pertama, baris pertama judul kolom:
`nama, email, no_wa, jabatan, gaji_pokok, tunjangan, lembur, potongan, tanggal_lahir`
`tanggal_lahir` ditulis hari/bulan/tahun (mis. 05/03/1990) atau sel bertipe tanggal. Password PDF = **DDMMYYYY** (05031990). Baris tanpa tanggal lahir valid dilewati.
(Tombol "Unduh template Excel" tersedia di halaman.) Nomor `0812…`, `+62 812…`, atau `812…` otomatis dinormalkan.

## Keamanan yang sudah diterapkan
- RLS aktif; hanya akun di tabel `admins` yang bisa baca/tulis. Pengunjung anonim tidak punya akses tabel.
- Pendaftaran publik dimatikan; admin hanya bisa ditambah lewat SQL Editor.
- API key Resend/Fonnte hanya di Supabase Secrets, tidak pernah ada di browser atau GitHub.
- Fungsi memakai JWT pengguna (bukan service_role) dan memeriksa status admin.
- Data dari Excel ditampilkan sebagai teks (tanpa HTML) dan email di-escape, jadi aman dari injeksi.
- Email dan nomor di tabel ditampilkan sebagian (masked). CSP membatasi halaman hanya ke Supabase.
- PDF disimpan di bucket Storage **private**; hanya admin yang bisa akses, dan WhatsApp memakai link sementara 15 menit. Menghapus batch ikut menghapus PDF-nya.
- Tanggal lahir hanya dipakai di browser untuk mengunci PDF, tidak dikirim ke database. Nominal gaji tidak ada di badan email/WA, hanya di dalam PDF.
- `.gitignore` menahan `.xlsx`, `.csv`, `.env`.

## Yang perlu Anda lakukan sendiri
- Aktifkan MFA di akun GitHub dan Supabase; pakai sandi unik untuk akun HRD.
- Hapus batch lama setelah slip terkirim (tombol "Hapus batch") sesuai kebijakan retensi.
- Jangan pernah commit file Excel gaji ke GitHub.

## Batasan versi ini
- Password PDF memakai enkripsi RC4 128-bit bawaan jsPDF (bukan AES) dan tanggal lahir mudah ditebak. Ini cukup menghalangi orang awam yang tidak sengaja membuka lampiran, tetapi bukan perlindungan kuat terhadap penyerang yang sengaja. Untuk keamanan lebih tinggi, ganti password dengan kode unik per karyawan yang dibagikan terpisah.
- Pengiriman file lewat Fonnte membutuhkan paket yang mendukung kirim file; cek di akun Anda.
- Tidak ada pelacakan "sudah dibaca" dan belum ada log audit terpisah (status kirim per karyawan tersimpan di tabel `slips`).
- Email/WA yang salah alamat tidak bisa ditarik kembali, jadi periksa data sebelum klik kirim.
