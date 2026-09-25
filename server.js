const express = require('express');
const axios = require('axios');
require('dotenv').config();
const app = express();
app.use(express.json({ limit: '10mb' }));

// ============================================================
// ⚙️ CẤU HÌNH CHỐNG GIỚI HẠN TỐI ƯU
// ============================================================
const CONFIG = {
  SEND_INTERVAL: 5000,        // ⏱️ 5 giây/gửi — an toàn tuyệt đối với Telegram
  ANTI_DUPLICATE_MS: 90 * 1000,
  MAX_QUEUE_SIZE: 10,
  MAX_RETRY: 1,               // Chỉ thử lại 1 lần — tránh vòng lặp
  RETRY_DELAY: 8000           // Chờ 8 giây mới thử lại
};

// ============================================================
// 🔑 KIỂM TRA BIẾN MÔI TRƯỜNG
// ============================================================
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('❌ Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID!');
  process.exit(1);
}
console.log('🤖 Telegram: ✅ Đã cấu hình');

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
// 📦 HÀNG ĐỢI — CHỐNG LẶP + GIỮ TỐC ĐỘ
// ============================================================
const messageQueue = [];
let isProcessingQueue = false;
const sentKeysToday = new Set();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getTodayKey() {
  return new Date().toISOString().split('T')[0];
}

function addToQueue(telegramText, embed, uniqueKey) {
  if (sentKeysToday.has(uniqueKey)) {
    console.log(`🚫 ĐÃ GỬI RỒI, BỎ QUA: ${uniqueKey}`);
    return false;
  }
  if (messageQueue.length >= CONFIG.MAX_QUEUE_SIZE) {
    console.log('⚠️ Hàng đợi đầy, bỏ qua');
    return false;
  }
  sentKeysToday.add(uniqueKey);
  messageQueue.push({ telegramText, embed, uniqueKey, retryCount: 0 });
  console.log(`✅ Đưa vào hàng đợi: ${uniqueKey}`);
  if (!isProcessingQueue) processQueue();
  return true;
}

// === GỬI TELEGRAM — XỬ LÝ 429 MỀM MẼ ===
async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await axios.post(url, {
    chat_id: TELEGRAM_CHAT_ID,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  });
  return res.data;
}

async function sendDiscord(embed) {
  if (!DISCORD_WEBHOOK_URL) return;
  await axios.post(DISCORD_WEBHOOK_URL, {
    embeds: [embed],
    username: 'Bot Chấm Công'
  });
}

async function processQueue() {
  isProcessingQueue = true;
  
  while (messageQueue.length > 0) {
    const item = messageQueue.shift();
    const { telegramText, embed, uniqueKey, retryCount } = item;

    try {
      await sendTelegram(telegramText);
      console.log(`✅ GỬI THÀNH CÔNG Telegram: ${uniqueKey}`);
      
      if (DISCORD_WEBHOOK_URL) {
        await sendDiscord(embed);
        console.log(`✅ GỬI THÀNH CÔNG Discord: ${uniqueKey}`);
      }

    } catch (e) {
      const status = e.response?.status;
      const errMsg = e.response?.data?.description || e.message;
      
      if (status === 429) {
        const retryAfter = (e.response?.data?.parameters?.retry_after || CONFIG.RETRY_DELAY / 1000) * 1000;
        console.log(`⚠️ Telegram giới hạn — chờ ${Math.round(retryAfter/1000)}s`);
        
        if (retryCount < CONFIG.MAX_RETRY) {
          item.retryCount++;
          messageQueue.unshift(item);
          await sleep(retryAfter);
          continue;
        }
        
        console.log(`❌ Đã thử ${CONFIG.MAX_RETRY+1} lần — bỏ qua: ${uniqueKey}`);
      } else {
        console.log(`❌ LỖI ${status}: ${errMsg}`);
      }
      
      // Thất bại → mở khóa để gửi lại sau này
      sentKeysToday.delete(uniqueKey);
    }

    await sleep(CONFIG.SEND_INTERVAL);
  }

  isProcessingQueue = false;
}

// ============================================================
// 🕐 ĐỊNH DẠNG THỜI GIAN
// ============================================================
function formatTimeFooter(date) {
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  const period = h >= 12 ? 'CH' : 'SA';
  const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${displayH}:${m} ${period}`;
}

// ============================================================
// 🎨 TẠO NỘI DUNG — DÙNG HTML
// ============================================================
function buildMessages(name, time, isCheckin, code) {
  const now = new Date();
  const timeFooter = formatTimeFooter(now);

  const telegramText = isCheckin
    ? `<b>✅ NHÂN VIÊN VÀO CA</b>\n\n👤 Họ tên: <b>${name}</b>\n🆔 Mã: <code>${code}</code>\n⏰ Thời gian: ${time}\n\n<i>Hệ thống chấm công DAHAHI · ${timeFooter}</i>`
    : `<b>🏠 NHÂN VIÊN RA CA</b>\n\n👤 Họ tên: <b>${name}</b>\n🆔 Mã: <code>${code}</code>\n⏰ Thời gian: ${time}\n\n<i>Hệ thống chấm công DAHAHI · ${timeFooter}</i>`;

  const embed = {
    title: isCheckin ? '✅ NHÂN VIÊN VÀO CA' : '🏠 NHÂN VIÊN RA CA',
    description: `**${name}** đã ${isCheckin ? 'bắt đầu' : 'kết thúc'} ca làm việc`,
    color: isCheckin ? 0x2ecc71 : 0xe67e22,
    fields: [
      { name: '👤 Họ và tên', value: name, inline: true },
      { name: '🆔 Mã nhân viên', value: `\`${code}\``, inline: true },
      { name: '⏰ Thời gian', value: time, inline: true }
    ],
    footer: { text: `Hệ thống chấm công DAHAHI · ${timeFooter}` },
    timestamp: now.toISOString()
  };

  return { telegramText, embed };
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

    console.log('📥 Nhận:', rawCode || 'KHÔNG CÓ MÃ');

    if (!rawCode) {
      return res.status(400).json({ error: 'Thiếu mã nhân viên' });
    }

    const normalizedCode = normalizeEmployeeCode(rawCode);
    if (!normalizedCode) {
      return res.status(400).json({ error: 'Mã không hợp lệ' });
    }

    // Chặn gửi liên tục
    const nowMs = Date.now();
    if (recentChecks.has(normalizedCode)) {
      const gap = nowMs - recentChecks.get(normalizedCode);
      if (gap < CONFIG.ANTI_DUPLICATE_MS) {
        console.log(`🚫 Bỏ qua (${Math.round(gap/1000)}s < 90s): ${normalizedCode}`);
        return res.json({ note: 'Đã chấm gần đây' });
      }
    }
    recentChecks.set(normalizedCode, nowMs);

    // Xác định Vào/Ra
    const isCheckin = determineCheckType(normalizedCode);
    const today = getTodayKey();
    const uniqueKey = `${normalizedCode}-${today}-${isCheckin ? 'in' : 'out'}`;

    if (sentKeysToday.has(uniqueKey)) {
      console.log(`🚫 Đã gửi trước đó: ${uniqueKey}`);
      return res.json({ note: 'Đã thông báo' });
    }

    const empName = p.EmployeeName || findEmployeeName(normalizedCode);
    const timeStr = p.CheckinTime || p.Time || new Date().toLocaleString('vi-VN');

    const { telegramText, embed } = buildMessages(empName, timeStr, isCheckin, normalizedCode);
    const added = addToQueue(telegramText, embed, uniqueKey);

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
// 🧪 TEST — KHÓA DUY NHẤT MỖI LẦN
// ============================================================
app.get('/test-telegram', (req, res) => {
  const uniqueKey = `TEST-${Date.now()}`;
  const timeNow = new Date().toLocaleString('vi-VN');
  
  const telegramText = `✅ <b>KẾT NỐI BOT THÀNH CÔNG</b>\n\n🤖 Bot hoạt động ổn định\n⏰ Thời gian: ${timeNow}\n\n<i>Hệ thống chấm công DAHAHI</i>`;
  
  messageQueue.push({ 
    telegramText, 
    embed: {}, 
    uniqueKey, 
    retryCount: 0 
  });
  sentKeysToday.add(uniqueKey);
  
  if (!isProcessingQueue) processQueue();
  
  res.json({ 
    ok: true, 
    message: '✅ Đã gửi tin thử — Kiểm tra Telegram!',
    note: 'Nếu không có tin → xem log lỗi'
  });
});

// ============================================================
// 🚀 KHỞI ĐỘNG
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('=========================================');
  console.log(`🚀 SERVER ĐANG CHẠY CỔNG: ${PORT}`);
  console.log(`🤖 Telegram: Đã kết nối — HTML ổn định`);
  console.log(`🛡️ Chống trùng: 90s + khóa ngay`);
  console.log(`⏱️ Gửi cách 5s — chống 429`);
  console.log(`🧪 Test: /test-telegram`);
  console.log('=========================================');
});
