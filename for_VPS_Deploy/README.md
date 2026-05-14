# GWM x Innopower — VPS Deployment

## ไฟล์ใหม่ที่เขียนสำหรับ VPS (3 ไฟล์)

| ไฟล์ | สถานะ | เหตุผล |
|------|--------|--------|
| `scripts/pull-daily.js` | **เขียนใหม่** | `.ps1` รันบน Linux ไม่ได้ → เขียนใหม่เป็น Node.js, logic เดิมทุกอย่าง |
| `nginx/gwm-dashboard.conf` | **ใหม่** | แทน `serve.ps1` — Nginx serve static files + basic auth |
| `setup.sh` | **ใหม่** | ติดตั้งทุกอย่างอัตโนมัติด้วยคำสั่งเดียว |

ไฟล์อื่นทั้งหมด (Dashboard/v3, Dashboard/v4-gwm, data/) **คัดลอกมาจาก setup_dashboard_v5 ได้เลย ไม่มีการเปลี่ยนแปลง**

---

## วิธี Deploy

### ขั้นตอนที่ 1 — อัปโหลดไฟล์ไป VPS

```bash
# จาก Windows — zip แล้ว upload ทั้งโฟลเดอร์ setup_dashboard_v5
# หรือใช้ scp:
scp -r "setup_dashboard_v5" root@<VPS_IP>:/tmp/gwm-deploy
```

### ขั้นตอนที่ 2 — รัน setup script

```bash
ssh root@<VPS_IP>
cd /tmp/gwm-deploy/for_VPS_Deploy
chmod +x setup.sh
sudo bash setup.sh
```

Script จะ:
- ติดตั้ง Nginx + Node.js อัตโนมัติ
- คัดลอกไฟล์ไปที่ `/var/www/gwm/`
- ถามว่าจะตั้ง credentials portal (ev.rpdservice.com) ยังไง
- ถามว่าจะสร้าง dashboard login (username/password) ยังไง
- ตั้ง cron job pull ข้อมูลทุกคืน 23:55 อัตโนมัติ

### ขั้นตอนที่ 3 — เสร็จแล้ว

```
Ops Dashboard:  http://<VPS_IP>/Dashboard/v3/
Exec Dashboard: http://<VPS_IP>/Dashboard/v4-gwm/
```

---

## Access Control

Dashboard ใช้ **HTTP Basic Auth** (username/password) ไม่มี Google login

| URL | ให้ใคร |
|-----|--------|
| `/Dashboard/v3/` | ops team เท่านั้น |
| `/Dashboard/v4-gwm/` | GWM exec (+ ops ถ้าต้องการ) |

แนะนำสร้าง user แยกกัน เช่น:
- `ops_innopower` → แจกให้ทีม ops
- `exec_gwm` → แจกให้ผู้บริหาร GWM

---

## การเพิ่ม/ลบ Dashboard User

```bash
# เพิ่ม user ใหม่
sudo htpasswd /etc/nginx/.htpasswd <username>

# ลบ user
sudo htpasswd -D /etc/nginx/.htpasswd <username>

# reload nginx
sudo systemctl reload nginx
```

---

## Pull ข้อมูลด้วยตัวเอง (นอกจาก cron)

```bash
node /var/www/gwm/scripts/pull-daily.js
```

## ดู log การ pull

```bash
tail -f /var/log/gwm-pull.log
```
