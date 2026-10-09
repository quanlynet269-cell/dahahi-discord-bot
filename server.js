const express = require('express');
const axios = require('axios');
require('dotenv').config();
const app = express();
app.use(express.json({ limit: '10mb' }));

// ============================================================
// ⚙️ CẤU HÌNH
// ============================================================
const CONFIG = {
  SEND_INTERVAL: 5000,
  ANTI_DUPLICATE_MS: 90 * 1000,
  MAX_QUEUE_SIZE: 10,
  MAX_RETRY: 1,
  RETRY_DELAY: 8000
};

// ============================================================
// 🔑 KIỂM TRA BIẾN MÔI TRƯỜNG — IN RA ĐỂ XÁC NHẬN
// ============================================================
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

console.log('=========================================');
console.log('🔍 KIỂM TRA CẤU HÌNH:');
console.log(`🤖 TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN ? '✅ Đã có' : '❌ Thiếu'}`);
console.log(`💬 DISCORD_WEBHOOK_URL: ${DISCORD_WEBHOOK_URL ? '✅ Đã có' : '❌ Thiếu'}`);
if (DISCORD_WEBHOOK_URL) {
  console.log(`→ Định dạng: ${DISCORD_WEBHOOK_URL.startsWith('https://discord.com/api/webhooks/') ? '✅ Đúng' : '⚠️ Sai định dạng'}`);
}
console.log('=========================================\n');

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('❌ Thiếu thông tin Telegram!');
  process.exit(1);
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
// 🔄 CHUẨN HÓA MÃ
// ============================================================
function normalizeEmployeeCode(code) {
  if (!code) return null;
  let str = String(code).trim().toUpperCase().replace(/\s+/g, '');
  if (str.startsWith('EMP')) return str;
  return `EMP${str.padStart(8, '0')}`;
}

function findEmployeeName(normalizedCode) {
  if (employeeNames[normalizedCode]) return employeeNames[normalizedCode];
  const numPart = normalizedCode.replace(/^EMP/, '');
  for (const [key, name] of Object.entries(employeeNames)) {
    if (key.endsWith(numPart)) return name;
  }
  return `Chưa cập nhật (${normalizedCode})`;
}

// ============================================================
// 📦 HÀNG ĐỢI
// ============================================================
const messageQueue = [];
let isProcessingQueue = false;
const sentKeysToday = new Set();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function getTodayKey() { return new Date().toISOString().split('T')[0]; }

function addToQueue(telegramText, discordPayload, uniqueKey) {
  if (sentKeysToday.has(uniqueKey)) {
    console.log(`🚫 ĐÃ GỬI → BỎ QUA: ${uniqueKey}`);
    return false;
  }
  if (messageQueue.length >= CONFIG.MAX_QUEUE_SIZE) {
    console.log('⚠️ Hàng đợi đầy');
    return false;
  }
  sentKeysToday.add(uniqueKey);
  messageQueue.push({ telegramText, discordPayload, uniqueKey, retryCount: 0 });
  console.log(`✅ ĐƯA VÀO HÀNG ĐỢI: ${uniqueKey}`);
  if (!isProcessingQueue) processQueue();
  return true;
}

// ============================================================
// 📤 GỬI TELEGRAM
// ============================================================
async function sendTelegram(text) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    }, { timeout: 15000 });
    console.log('✅ Telegram: Đã gửi');
    return true;
  } catch (e) {
    console.log('❌ Telegram lỗi:', e.response?.data?.description || e.message);
    return false;
  }
}

// ============================================================
// 📤 GỬI DISCORD — ĐÃ SỬA: ĐỊNH DẠNG ĐÚNG + ĐỢI KẾT QUẢ
// ============================================================
async function sendDiscord(payload) {
  if (!DISCORD_WEBHOOK_URL) {
    console.log('⏭️ Discord: Bỏ qua — chưa cấu hình Webhook URL');
    return false;
  }

  console.log('📤 Đang gửi Discord...');
  console.log('📋 Dữ liệu gửi:', JSON.stringify(payload, null, 2));

  try {
    const res = await axios.post(DISCORD_WEBHOOK_URL, payload, {
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(`✅ Discord: GỬI THÀNH CÔNG (HTTP ${res.status}) → Kiểm tra kênh!`);
    return true;
  } catch (e) {
    console.log('❌ Discord LỖI ===');
    if (e.response) {
      console.log(`→ Mã lỗi: ${e.response.status}`);
      console.log(`→ Chi tiết:`, e.response.data);
      if (e.response.status === 404) {
        console.log(`→ 💡 Nguyên nhân: Webhook URL SAI hoặc ĐÃ BỊ XÓA`);
      }
      if (e.response.status === 401) {
        console.log(`→ 💡 Nguyên nhân: Token Webhook KHÔNG HỢP LỆ`);
      }
    } else {
      console.log(`→ Lỗi: ${e.message}`);
    }
    console.log('==================');
    return false;
  }
}

// ============================================================
// 🔄 XỬ LÝ HÀNG ĐỢI
// ============================================================
async function processQueue() {
  isProcessingQueue = true;
  console.log('\n🔄 Bắt đầu xử lý hàng đợi...');

  while (messageQueue.length > 0) {
    const item = messageQueue.shift();
    const { telegramText, discordPayload, uniqueKey } = item;

    console.log(`\n━━━━━━ XỬ LÝ: ${uniqueKey} ━━━━━━`);

    // Gửi song song
    await Promise.all([
      sendTelegram(telegramText),
      sendDiscord(discordPayload)
    ]);

    await sleep(CONFIG.SEND_INTERVAL);
  }

  isProcessingQueue = false;
  console.log('\n✅ Đã xử lý xong tất cả');
}

// ============================================================
// 🎨 TẠO NỘI DUNG — ĐÚNG ĐỊNH DẠNG DISCORD
// ============================================================
function buildMessages(name, time, isCheckin, code) {
  const now = new Date();
  const timeFooter = now.toLocaleString('vi-VN');
  const typeText = isCheckin ? 'NHÂN VIÊN VÀO CA' : 'NHÂN VIÊN RA CA';
  const colorCode = isCheckin ? 0x2ecc71 : 0xf59e0b;

  // Nội dung Telegram
  const telegramText = `✅ <b>THÔNG BÁO CHẤM CÔNG TIỆM 15</b>\n<b>${typeText}</b>\n\n👤 Họ tên: ${name}\n🆔 Mã: <code>${code}</code>\n⏰ Thời gian: ${time}\n\n<i>Hệ thống chấm công DAHAHI · ${timeFooter}</i>`;

  // Nội dung Discord — CÓ content + embeds = chắc chắn hiện
  const discordPayload = {
    content: `🔔 **${typeText}**`,
    embeds: [{
      title: `✅ ${typeText}`,
      description: `**${name}**`,
      color: colorCode,
      fields: [
        { name: '🆔 Mã nhân viên', value: `\`${code}\``, inline: true },
        { name: '⏰ Thời gian', value: time, inline: true }
      ],
      footer: { text: `Hệ thống chấm công DAHAHI · ${timeFooter}` },
      timestamp: now.toISOString()
    }]
  };

  return { telegramText, discordPayload };
}

// ============================================================
// 📊 TRẠNG THÁI VÀO/RA CA
// ============================================================
const employeeState = {};

function getCurrentState(code) {
  const today = getTodayKey();
  if (!employeeState[code] || employeeState[code].date !== today) {
    employeeState[code] = { date: today, lastType: null };
  }
  return employeeState[code];
}

function determineCheckType(code) {
  const state = getCurrentState(code);
  if (!state.lastType) {
    state.lastType = 'in';
    return true;
  }
  const nextIsIn = state.lastType === 'out';
  state.lastType = nextIsIn ? 'in' : 'out';
  return nextIsIn;
}

// ============================================================
// 📥 NHẬN DỮ LIỆU TỪ MÁY CHẤM CÔNG
// ============================================================
const recentChecks = new Map();

app.post('/webhook/dahahi', async (req, res) => {
  try {
    const p = req.body;
    const rawCode = p.EmployeeCode || p.FacePersonId || p.id || p.employee_id;
    console.log('\n📥 Nhận:', rawCode || 'KHÔNG CÓ MÃ');

    if (!rawCode) {
      return res.status(400).json({ error: 'Thiếu mã nhân viên' });
    }

    const normalizedCode = normalizeEmployeeCode(rawCode);
    if (!normalizedCode) {
      return res.status(400).json({ error: 'Mã không hợp lệ' });
    }

    // Chặn trùng
    const nowMs = Date.now();
    if (recentChecks.has(normalizedCode)) {
      const gap = nowMs - recentChecks.get(normalizedCode);
      if (gap < CONFIG.ANTI_DUPLICATE_MS) {
        console.log(`🚫 Bỏ qua trùng: ${normalizedCode} (cách ${Math.round(gap/1000)}s)`);
        return res.json({ note: 'Đã nhận' });
      }
    }
    recentChecks.set(normalizedCode, nowMs);

    const isCheckin = determineCheckType(normalizedCode);
    const uniqueKey = `${normalizedCode}-${getTodayKey()}-${isCheckin ? 'in' : 'out'}`;

    if (sentKeysToday.has(uniqueKey)) {
      console.log(`🚫 Đã gửi trước đó → Bỏ qua: ${uniqueKey}`);
      return res.json({ note: 'Đã thông báo' });
    }

    const empName = p.EmployeeName || findEmployeeName(normalizedCode);
    const timeStr = p.CheckinTime || p.Time || new Date().toLocaleString('vi-VN');
    const { telegramText, discordPayload } = buildMessages(empName, timeStr, isCheckin, normalizedCode);
    
    const added = addToQueue(telegramText, discordPayload, uniqueKey);

    res.json({
      ok: true,
      name: empName,
      code: normalizedCode,
      type: isCheckin ? 'VÀO CA' : 'RA CA',
      sent: added
    });
  } catch (e) {
    console.error('❌ LỖI:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 🧪 TEST — GỌI TRỰC TIẾP ĐỂ KIỂM TRA
// ============================================================
app.get('/test-discord', async (req, res) => {
  console.log('\n🧪 === Bắt đầu test Discord ===');
  
  if (!DISCORD_WEBHOOK_URL) {
    return res.json({ error: 'Thiếu DISCORD_WEBHOOK_URL trong file .env' });
  }

  const testPayload = {
    content: '🔔 **KIỂM TRA KẾT NỐI DISCORD**',
    embeds: [{
      title: '✅ KẾT NỐI THÀNH CÔNG',
      description: 'Nếu bạn thấy tin này → Discord hoạt động bình thường!',
      color: 0x2ecc71,
      timestamp: new Date().toISOString()
    }]
  };

  const ok = await sendDiscord(testPayload);
  
  res.json({
    success: ok,
    message: ok ? '✅ Đã gửi → Kiểm tra kênh Discord!' : '❌ Xem log lỗi ở trên'
  });
});

app.get('/test-telegram', async (req, res) => {
  const timeNow = new Date().toLocaleString('vi-VN');
  const testText = `✅ <b>KẾT NỐI THÀNH CÔNG</b>\n\n⏰ Thời gian: ${timeNow}`;
  await sendTelegram(testText);
  res.json({ success: true, message: 'Đã gửi tin Telegram' });
});

// ============================================================
// 🚀 KHỞI ĐỘNG
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('=========================================');
  console.log(`🚀 Server: http://localhost:${PORT}`);
  console.log(`🧪 Test Discord:  http://localhost:${PORT}/test-discord`);
  console.log(`🧪 Test Telegram: http://localhost:${PORT}/test-telegram`);
  console.log('=========================================\n');
});
