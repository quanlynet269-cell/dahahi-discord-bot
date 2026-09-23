const express = require('express');
const axios = require('axios');
require('dotenv').config();
const app = express();
app.use(express.json({ limit: '10mb' }));

// ============================================================
// ⚙️ CẤU HÌNH
// ============================================================
const CONFIG = {
  SEND_INTERVAL: 3000,        // 3 giây/tin = 20 tin/phút — an toàn tuyệt đối
  ANTI_DUPLICATE_MS: 2 * 60 * 1000,
  MAX_QUEUE_SIZE: 100
};

// ============================================================
// 🔑 KIỂM TRA WEBHOOK
// ============================================================
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
if (!DISCORD_WEBHOOK_URL) {
  console.error('❌ Thiếu DISCORD_WEBHOOK_URL!');
  process.exit(1);
}
console.log('🔑 Webhook URL: ✅ Đã cấu hình');
console.log(`⚙️ Gửi 1 tin mỗi ${CONFIG.SEND_INTERVAL/1000}s → ${Math.round(60000/CONFIG.SEND_INTERVAL)} tin/phút`);

// ============================================================
// 📦 HÀNG ĐỢI
// ============================================================
const messageQueue = [];
let isProcessingQueue = false;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function addToQueue(embed) {
  if (messageQueue.length >= CONFIG.MAX_QUEUE_SIZE) {
    console.log('⚠️ Hàng đợi đầy');
    return false;
  }
  messageQueue.push({ embed, addedAt: Date.now() });
  if (!isProcessingQueue) processQueue();
  return true;
}

async function processQueue() {
  isProcessingQueue = true;
  while (messageQueue.length > 0) {
    const { embed } = messageQueue.shift();
    try {
      await axios.post(DISCORD_WEBHOOK_URL, {
        embeds: [embed],
        username: 'Bot Chấm Công'
      });
      console.log(`✅ Gửi thành công — Còn lại: ${messageQueue.length}`);
    } catch (e) {
      console.error('❌ Lỗi gửi:', e.response?.status || e.message);
    }
    await sleep(CONFIG.SEND_INTERVAL);
  }
  isProcessingQueue = false;
}

// ============================================================
// 👥 DANH SÁCH NHÂN VIÊN
// ============================================================
const employeeNames = {
  'EMP00000003': 'Dương Nhất Vy',
  'EMP00000007': 'Lê Ngọc Anh Thi',
  'EMP00000008': 'Nguyễn Thống Nhất',
  'EMP00000009': 'Nghiêm Tuấn Phúc',
  'EMP00000010': 'Trần An Nhật Minh',
  'EMP00000011': 'Nguyễn Minh Sang',
  'EMP00000012': 'Nguyễn Thái Tuấn Kiệt',
  'EMP00000013': 'Trần Anh Tuấn Kiệt',
  'EMP00000014': 'Trần Châu Thanh Kim',
  'EMP00000015': 'Nguyễn Mạnh Duy',
  'EMP00000018': 'Lê Thị Thu Hoà',
  'EMP00000020': 'Nguyễn Hoàng Ngọc Châu',
  'EMP00000023': 'Ngô Thanh Trúc',
  'EMP00000024': 'Trần Khả Di',
  'EMP00000025': 'Nguyễn Duy Chiên',
  'EMP00000026': 'Ngô Thanh Hảo',
  'EMP00000030': 'Nguyễn Gia Kiệt',
  'EMP00000032': 'Vũ Đình Nam',
  'EMP00000033': 'Nguyễn Thu An',
  'EMP00000035': 'Đỗ Vũ Bảo Anh',
  'EMP00000036': 'Lâm Phước Hội',
  'EMP00000037': 'Trần Việt Nhật',
  'EMP00000038': 'Nguyễn Quốc Luân',
  'EMP00000039': 'Hồ Văn Hậu',
  'EMP00000040': 'Nguyễn Đình Bảo An'
};

// ============================================================
// 🔒 CHỐNG TRÙNG
// ============================================================
const lastStatus = {};
const recentRequests = new Map();

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function isDuplicate(code) {
  if (recentRequests.has(code)) {
    if (Date.now() - recentRequests.get(code) < CONFIG.ANTI_DUPLICATE_MS) {
      return true;
    }
  }
  recentRequests.set(code, Date.now());
  return false;
}

// ============================================================
// 🎨 TẠO TIN NHẮN
// ============================================================
function buildEmbed(name, time, isCheckin, code) {
  return {
    title: isCheckin ? '✅ VÀO CA' : '👋 RA CA',
    description: `**${name}**`,
    color: isCheckin ? 5763719 : 15548997,
    fields: [
      { name: '🆔 Mã NV', value: `\`${code}\``, inline: true },
      { name: '⏰ Thời gian', value: time, inline: true }
    ],
    timestamp: new Date().toISOString()
  };
}

// ============================================================
// 📥 API NHẬN DỮ LIỆU
// ============================================================
app.post('/webhook/dahahi', async (req, res) => {
  try {
    const p = req.body;
    const code = p.EmployeeCode || p.FacePersonId;
    const timeStr = p.CheckinTime || p.Time || new Date().toLocaleString('vi-VN');

    if (!code) return res.status(400).json({ error: 'Thiếu mã nhân viên' });
    if (isDuplicate(code)) return res.json({ note: 'Bỏ qua trùng lặp' });

    const empName = employeeNames[code] || code;
    const today = getToday();
    let isCheckin = true;

    if (lastStatus[code] && lastStatus[code].date === today) {
      isCheckin = !lastStatus[code].isCheckin;
    }
    lastStatus[code] = { date: today, isCheckin };

    addToQueue(buildEmbed(empName, timeStr, isCheckin, code));
    res.json({ ok: true, name: empName, type: isCheckin ? 'in' : 'out' });
  } catch (e) {
    console.error('❌ Lỗi:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 🧪 KIỂM TRA
// ============================================================
app.get('/test-send', (req, res) => {
  addToQueue(buildEmbed('Nguyễn Văn Test', new Date().toLocaleString('vi-VN'), true, 'TEST001'));
  res.json({ ok: true, message: 'Đã gửi tin thử → Kiểm tra Discord!' });
});

// ============================================================
// 🚀 KHỞI ĐỘNG
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('=========================================');
  console.log(`🚀 SERVER ĐANG CHẠY CỔNG: ${PORT}`);
  console.log(`✅ Sử dụng Webhook — Không cần Bot kết nối!`);
  console.log(`📡 Địa chỉ: https://dahahi-discord-bot.onrender.com`);
  console.log('=========================================');
});
