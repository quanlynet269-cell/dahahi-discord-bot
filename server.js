const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
require('dotenv').config();
const app = express();
app.use(express.json({ limit: '10mb' }));

const CONFIG = {
  SEND_INTERVAL: 1000,
  ANTI_DUPLICATE_MS: 2 * 60 * 1000,
  MAX_QUEUE_SIZE: 200
};

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

console.log('🔑 Kiểm tra biến môi trường...');
console.log('DISCORD_BOT_TOKEN:', DISCORD_BOT_TOKEN ? '✅ Đã có (' + DISCORD_BOT_TOKEN.substring(0, 6) + '...)' : '❌ Thiếu');
console.log('DISCORD_CHANNEL_ID:', DISCORD_CHANNEL_ID ? '✅ Đã có (' + DISCORD_CHANNEL_ID + ')' : '❌ Thiếu');

if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID) {
  console.error('❌ Thiếu biến môi trường! Vào Render → Environment thêm.');
  process.exit(1);
}

const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

bot.on('ready', () => {
  console.log('=========================================');
  console.log(`🤖 ✅ BOT ĐĂNG NHẬP THÀNH CÔNG: ${bot.user.tag}`);
  console.log(`📢 Kênh đích ID: ${DISCORD_CHANNEL_ID}`);
  const channel = bot.channels.cache.get(DISCORD_CHANNEL_ID);
  if (channel) {
    console.log(`📢 ✅ Tìm thấy kênh: #${channel.name}`);
  } else {
    console.log(`⚠️ Không tìm thấy kênh, kiểm tra ID và Bot đã vào máy chủ`);
  }
  console.log('=========================================');
});

bot.on('error', (err) => {
  console.error('❌ LỖI KẾT NỐI BOT:', err.message);
});

bot.login(DISCORD_BOT_TOKEN)
  .catch(err => {
    console.error('❌ KHÔNG ĐĂNG NHẬP ĐƯỢC:', err.message);
    process.exit(1);
  });

// === PHẦN CÒN LẠI GIỮ NGUYÊN ===
const messageQueue = [];
let isProcessingQueue = false;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function addToQueue(embed) {
  if (messageQueue.length >= CONFIG.MAX_QUEUE_SIZE) { console.log('⚠️ Hàng đợi đầy'); return false; }
  messageQueue.push({ embed, addedAt: Date.now() });
  if (!isProcessingQueue) processQueue();
  return true;
}

async function processQueue() {
  isProcessingQueue = true;
  const channel = bot.channels.cache.get(DISCORD_CHANNEL_ID);
  if (!channel) { console.error('❌ Không tìm thấy kênh'); isProcessingQueue = false; return; }
  while (messageQueue.length > 0) {
    const { embed } = messageQueue.shift();
    try { await channel.send({ embeds: [embed] }); }
    catch (e) { console.error('❌ Lỗi gửi:', e.message); }
    await sleep(CONFIG.SEND_INTERVAL);
  }
  isProcessingQueue = false;
}

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

const lastStatus = {};
const recentRequests = new Map();
function getToday() { return new Date().toISOString().split('T')[0]; }
function isDuplicate(code) {
  if (recentRequests.has(code)) {
    if (Date.now() - recentRequests.get(code) < CONFIG.ANTI_DUPLICATE_MS) return true;
  }
  recentRequests.set(code, Date.now());
  return false;
}

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
      isCheckin = lastStatus[code].type === 'out';
    }
    lastStatus[code] = { date: today, type: isCheckin ? 'in' : 'out' };
    addToQueue(buildEmbed(empName, timeStr, isCheckin, code));
    res.json({ ok: true, name: empName, type: isCheckin ? 'in' : 'out' });
  } catch (e) {
    console.error('❌ Lỗi:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/test-send', (req, res) => {
  addToQueue(buildEmbed('Nguyễn Văn Test', new Date().toLocaleString('vi-VN'), true, 'TEST001'));
  res.json({ ok: true, message: 'Đã gửi tin thử — Kiểm tra Discord!' });
});

app.get('/status', (req, res) => {
  res.json({ botReady: bot.isReady(), queue: messageQueue.length });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('=========================================');
  console.log(`🚀 SERVER ĐANG CHẠY CỔNG: ${PORT}`);
  console.log(`🤖 Chờ Bot kết nối...`);
  console.log(`📡 Địa chỉ: https://dahahi-discord-bot.onrender.com`);
  console.log('=========================================');
});
