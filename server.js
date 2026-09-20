const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '10mb' }));

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Map mã nhân viên → tên hiển thị (thêm/sửa theo danh sách của bạn)
const employeeNames = {
  'EMP000149': 'Nguyễn Thị Huyền',
  'P0001': 'Nguyễn Văn A',
  'P0002': 'Nguyễn Văn B',
  // Thêm nhân viên của bạn ở đây...
};

// Gửi tin vào Discord
async function sendDiscord(embed) {
  await axios.post(DISCORD_WEBHOOK_URL, {
    embeds: [embed],
    username: 'Bot Chấm Công'
  });
}

// Tạo tin nhắn đẹp
function buildEmbed(code, type, time, device) {
  const name = employeeNames[code] || `Mã: ${code}`;
  const isIn = type === 'checkin';
  return {
    title: isIn ? '▶ NHÂN VIÊN VÀO CA' : '■ NHÂN VIÊN RA CA',
    color: isIn ? 5763719 : 15548997,
    fields: [
      { name: '👤 Nhân viên', value: `**${name}**`, inline: true },
      { name: '⏰ Thời gian', value: time || '—', inline: true },
      { name: '📍 Thiết bị', value: device || 'Máy chấm công', inline: false }
    ],
    footer: { text: 'Hệ thống DAHAHI' },
    timestamp: new Date().toISOString()
  };
}

// Webhook nhận từ DAHAHI
app.post('/webhook/dahahi', async (req, res) => {
  try {
    const p = req.body;
    console.log('📩 Nhận:', JSON.stringify(p));
    
    const code = p.employeeCode || p.maNhanVien || p.UserId;
    const type = p.eventType || (p.checkType === 'in' ? 'checkin' : 'checkout');
    const time = p.time || p.thoiGian || p.CheckTime;
    const device = p.deviceName || p.DeviceName;
    
    if (!code) return res.status(200).json({ ok: true, note: 'no_code' });
    
    await sendDiscord(buildEmbed(code, type, time, device));
    res.json({ ok: true, sent: code });
  } catch (e) {
    console.error('❌ Lỗi:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Test nhanh
app.get('/test', async (req, res) => {
  try {
    await sendDiscord(buildEmbed('EMP000149', 'checkin', new Date().toLocaleString('vi-VN'), 'Test Server'));
    res.send('✅ Đã gửi tin test! Kiểm tra kênh Discord #cham-cong');
  } catch (e) {
    res.status(500).send('❌ Lỗi: ' + e.message);
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server chạy: http://localhost:${PORT}`);
  console.log(`🧪 Test:  http://localhost:${PORT}/test`);
});