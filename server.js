const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
require('dotenv').config();
const app = express();
app.use(express.json({ limit: '10mb' }));

// ============================================================
// ⚙️ CẤU HÌNH
// ============================================================
const CONFIG = {
  SEND_INTERVAL: 1000,        // 1 giây/gửi — giới hạn 3000 tin/phút
  ANTI_DUPLICATE_MS: 2 * 60 * 1000,
  MAX_QUEUE_SIZE: 200
};

// ============================================================
// 🤖 KẾT NỐI BOT DISCORD
// ============================================================
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID) {
  console.error('❌ Thiếu DISCORD_BOT_TOKEN hoặc DISCORD_CHANNEL_ID');
  process.exit(1);
}

const bot = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

bot.login(DISCORD_BOT_TOKEN);

bot.on('ready', () => {
  console.log(`🤖 Bot đã đăng nhập: ${bot.user.tag}`);
  console.log(`📢 Kênh đích: ${DISCORD_CHANNEL_ID}`);
});

// ============================================================
// 📦 HÀNG ĐỢI GỬI TIN
// ============================================================
const messageQueue = [];
let isProcessingQueue = false;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function addToQueue(embed) {
  if (messageQueue.length >= CONFIG.MAX_QUEUE_SIZE) {
    console.log('⚠️ Hàng đợi đầy, bỏ qua');
    return false;
  }
  messageQueue.push({ embed, addedAt: Date.now() });
  console.log(`➕ Thêm hàng đợi: ${messageQueue.length}`);
  if (!isProcessingQueue) processQueue();
  return true;
}

async function processQueue() {
  isProcessingQueue = true;
  const channel = bot.channels.cache.get(DISCORD_CHANNEL_ID);
  if (!channel) {
    console.error('❌ Không tìm thấy kênh! Kiểm tra DISCORD_CHANNEL_ID và quyền bot');
    isProcessingQueue = false;
    return;
  }

  while (messageQueue.length > 0) {
    const { embed } = messageQueue.shift();
    try {
      await channel.send({ embeds: [embed] });
      console.log(`✅ Đã gửi — Còn lại: ${messageQueue.length}`);
    } catch (e) {
      console.error('❌ Lỗi gửi:', e.message);
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

function isAfterResetTime() {
  const h = new Date().getHours();
  return h > 5;
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function isDuplicate(code) {
  const now = Date.now();
  if (recentRequests.has(code)) {
    if (now - recentRequests.get(code) < CONFIG.ANTI_DUPLICATE_MS) {
      return true;
    }
  }
  recentRequests.set(code, now);
  return false;
}

// ============================================================
// 🎨 TẠO NỘI DUNG TIN
// ============================================================
function buildEmbed(name, time, isCheckin, code) {
  return new EmbedBuilder()
    .setTitle(isCheckin ? '✅ ĐIỂM DANH — ĐẾN LÀM' : '🏠 ĐIỂM DANH — KẾT THÚC')
    .setDescription(`**${name}**`)
    .setColor(isCheckin ? 0x57f287 : 0xf38ba8)
    .addFields(
      { name: '🆔 Mã NV', value: `\`${code}\``, inline: true },
      { name: '🕐 Thời gian', value: time, inline: true }
    )
    .setTimestamp();
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

    if (!lastStatus[code] || lastStatus[code].date !== today) {
      lastStatus[code] = { date: today, type: 'in' };
    } else {
      isCheckin = lastStatus[code].type === 'out';
      lastStatus[code].type = isCheckin ? 'in' : 'out';
    }

    const embed = buildEmbed(empName, timeStr, isCheckin, code);
    addToQueue(embed);

    res.json({ ok: true, name: empName, type: isCheckin ? 'in' : 'out' });
  } catch (e) {
    console.error('❌ Lỗi xử lý:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 🧪 API KIỂM TRA
// ============================================================
app.get('/test-send', (req, res) => {
  const embed = buildEmbed('Nguyễn Văn Test', new Date().toLocaleString('vi-VN'), true, 'TEST001');
  addToQueue(embed);
  res.json({ ok: true, message: 'Đã gửi tin thử — Kiểm tra Discord!' });
});

app.get('/status', (req, res) => {
  res.json({
    botReady: bot.isReady(),
    queueLength: messageQueue.length,
    processing: isProcessingQueue,
    config: { sendInterval: CONFIG.SEND_INTERVAL + 'ms' }
  });
});

// ============================================================
// 🚀 KHỞI ĐỘNG
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('=========================================');
  console.log(`🚀 SERVER ĐANG CHẠY CỔNG: ${PORT}`);
  console.log(`🤖 Chờ Bot kết nối...`);
  console.log(`📡 Địa chỉ: https://dahahi-discord-bot.onrender.com`);
  console.log('=========================================');
});
