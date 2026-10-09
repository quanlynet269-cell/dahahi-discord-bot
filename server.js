const express = require('express');
const axios = require('axios');
require('dotenv').config();
const app = express();
app.use(express.json({ limit: '10mb' }));

// ============================================================
// ⚙️ CẤU HÌNH — TỐI ƯU CHO DISCORD
// ============================================================
const CONFIG = {
  SEND_INTERVAL: 6000,        // Gửi cách 6 giây (tăng lên tránh bị chặn)
  ANTI_DUPLICATE_MS: 120000,  // Chặn trùng 2 phút
  MAX_RETRY: 2,               // Thử lại tối đa 2 lần
  RETRY_DELAY_BASE: 30000     // Đợi 30s trước khi thử lại
};

// ============================================================
// 🔑 BIẾN MÔI TRƯỜNG
// ============================================================
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

console.log('=========================================');
console.log('🔍 KIỂM TRA CẤU HÌNH:');
console.log(`🤖 Telegram: ${TELEGRAM_BOT_TOKEN ? '✅ Đã có' : '❌ Thiếu'}`);
console.log(`💬 Discord: ${DISCORD_WEBHOOK_URL ? '✅ Đã có' : '❌ Thiếu'}`);
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
// 🛡️ HÀM CHUNG
// ============================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function getTodayKey() { return new Date().toISOString().split('T')[0]; }

function normalizeEmployeeCode(code) {
  if (!code) return null;
  let str = String(code).trim().toUpperCase().replace(/\s+/g, '');
  return str.startsWith('EMP') ? str : `EMP${str.padStart(8, '0')}`;
}

function findEmployeeName(code) {
  if (employeeNames[code]) return employeeNames[code];
  const numPart = code.replace(/^EMP/, '');
  for (const [key, name] of Object.entries(employeeNames)) {
    if (key.endsWith(numPart)) return name;
  }
  return `Chưa cập nhật (${code})`;
}

// ============================================================
// 📤 GỬI DISCORD — XỬ LÝ GIỚI HẠN TỐC ĐỘ
// ============================================================
let discordLastSent = 0;
let discordFailCount = 0;

async function sendDiscord(payload, retryCount = 0) {
  if (!DISCORD_WEBHOOK_URL) {
    console.log('⏭️ Discord: Bỏ qua — chưa cấu hình');
    return false;
  }

  // Tự động chờ để không bị giới hạn tốc độ
  const timeSinceLast = Date.now() - discordLastSent;
  if (timeSinceLast < 3000) {
    const waitTime = 3000 - timeSinceLast;
    console.log(`⏳ Chờ ${waitTime}ms trước khi gửi Discord...`);
    await sleep(waitTime);
  }

  try {
    console.log('📤 Đang gửi Discord...');
    const res = await axios.post(DISCORD_WEBHOOK_URL, payload, {
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' }
    });
    
    discordLastSent = Date.now();
    discordFailCount = 0;
    console.log(`✅ Discord: GỬI THÀNH CÔNG (HTTP ${res.status})`);
    return true;

  } catch (e) {
    discordFailCount++;
    
    // Phát hiện giới hạn tốc độ → tự động thử lại sau
    if (e.response?.status === 429 || e.response?.status === 403) {
      const retryAfter = e.response.data?.retry_after || CONFIG.RETRY_DELAY_BASE / 1000;
      const waitSec = retryAfter * (retryCount + 1); // Nhân gấp đôi mỗi lần
      
      console.log(`⚠️ Discord giới hạn tốc độ → chờ ${waitSec}s rồi thử lại (lần ${retryCount + 1}/${CONFIG.MAX_RETRY + 1})`);
      
      if (retryCount < CONFIG.MAX_RETRY) {
        await sleep(waitSec * 1000);
        return sendDiscord(payload, retryCount + 1);
      }
    }

    console.log(`❌ Discord lỗi (thử ${retryCount + 1} lần): ${e.response?.status || e.message}`);
    if (discordFailCount >= 3) {
      console.log('💡 Thất bại nhiều lần — có thể IP Render bị chặn bởi Discord/Cloudflare');
    }
    return false;
  }
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
// 🎨 TẠO NỘI DUNG THÔNG BÁO
// ============================================================
function buildMessages(name, time, isCheckin, code) {
  const now = new Date();
  const timeFooter = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const typeText = isCheckin ? 'NHÂN VIÊN VÀO CA' : 'NHÂN VIÊN RA CA';
  const colorCode = isCheckin ? 0x2ecc71 : 0xf59e0b;

  const telegramText = `<b>✅ THÔNG BÁO CHẤM CÔNG TIỆM 15</b>\n<b>${typeText}</b>\n\n👤 Họ tên: ${name}\n🆔 Mã: <code>${code}</code>\n⏰ Thời gian: ${time}\n\n<i>Hệ thống DAHAHI · ${timeFooter}</i>`;

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
      footer: { text: `Hệ thống DAHAHI · ${timeFooter}` },
      timestamp: now.toISOString()
    }]
  };

  return { telegramText, discordPayload };
}

// ============================================================
// 📊 TRẠNG THÁI VÀO/RA CA & CHỐNG TRÙNG
// ============================================================
const employeeState = {};
const sentUniqueKeys = new Set();
const processingLocks = new Map();

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
// 📥 NHẬN YÊU CẦU TỪ DAHAHI
// ============================================================
app.post('/webhook/dahahi', async (req, res) => {
  const startTime = Date.now();
  let normalizedCode = null;

  try {
    const p = req.body;
    const rawCode = p.EmployeeCode || p.FacePersonId || p.id || p.employee_id;
    console.log('\n📥 Nhận yêu cầu:', rawCode || 'KHÔNG CÓ MÃ');

    if (!rawCode) return res.status(400).json({ error: 'Thiếu mã nhân viên' });

    normalizedCode = normalizeEmployeeCode(rawCode);
    if (!normalizedCode) return res.status(400).json({ error: 'Mã không hợp lệ' });

    // Khóa chống trùng ngay lập tức
    if (processingLocks.has(normalizedCode)) {
      const lockTime = processingLocks.get(normalizedCode);
      if (startTime - lockTime < CONFIG.ANTI_DUPLICATE_MS) {
        console.log(`🚫 ĐANG XỬ LÝ → BỎ QUA: ${normalizedCode}`);
        return res.json({ note: 'Đang xử lý, bỏ qua lặp', code: normalizedCode });
      }
    }
    processingLocks.set(normalizedCode, startTime);

    const isCheckin = determineCheckType(normalizedCode);
    const uniqueKey = `${normalizedCode}-${getTodayKey()}-${isCheckin ? 'IN' : 'OUT'}`;

    if (sentUniqueKeys.has(uniqueKey)) {
      console.log(`🚫 ĐÃ GỬI → BỎ QUA: ${uniqueKey}`);
      return res.json({ note: 'Đã thông báo', code: normalizedCode });
    }

    // Tạo & gửi
    const empName = p.EmployeeName || findEmployeeName(normalizedCode);
    const timeStr = p.CheckinTime || p.Time || new Date().toLocaleString('vi-VN');
    const { telegramText, discordPayload } = buildMessages(empName, timeStr, isCheckin, normalizedCode);

    await Promise.all([
      sendTelegram(telegramText),
      sendDiscord(discordPayload)
    ]);

    sentUniqueKeys.add(uniqueKey);
    console.log(`✅ HOÀN THÀNH: ${empName} | ${isCheckin ? 'VÀO' : 'RA'}`);

    res.json({
      ok: true,
      name: empName,
      code: normalizedCode,
      type: isCheckin ? 'VÀO CA' : 'RA CA'
    });

  } catch (e) {
    console.error('❌ LỖI:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 🧪 TEST
// ============================================================
app.get('/test-discord', async (req, res) => {
  console.log('\n🧪 === Test Discord ===');
  if (!DISCORD_WEBHOOK_URL) {
    return res.json({ error: 'Chưa cấu hình DISCORD_WEBHOOK_URL' });
  }

  const payload = {
    content: '🔔 **KIỂM TRA KẾT NỐI DISCORD**',
    embeds: [{
      title: '✅ KẾT NỐI THÀNH CÔNG',
      description: 'Hệ thống đang hoạt động bình thường!',
      color: 0x2ecc71,
      timestamp: new Date().toISOString()
    }]
  };

  const ok = await sendDiscord(payload);
  res.json({
    success: ok,
    message: ok ? '✅ Đã gửi → Kiểm tra kênh Discord!' : '❌ Thất bại — xem log chi tiết'
  });
});

app.get('/test-telegram', async (req, res) => {
  const timeNow = new Date().toLocaleString('vi-VN');
  await sendTelegram(`✅ <b>KẾT NỐI THÀNH CÔNG</b>\n⏰ ${timeNow}`);
  res.json({ success: true, message: 'Đã gửi Telegram' });
});

// ============================================================
// 🚀 KHỞI ĐỘNG
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('=========================================');
  console.log(`🚀 Server chạy cổng ${PORT}`);
  console.log(`🧪 Test Discord:  /test-discord`);
  console.log(`🧪 Test Telegram: /test-telegram`);
  console.log(`📥 Webhook:        /webhook/dahahi`);
  console.log('=========================================\n');
});
