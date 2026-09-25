const express = require('express');
const axios = require('axios');
require('dotenv').config();
const app = express();
app.use(express.json({ limit: '10mb' }));

// ============================================================
// ⚙️ CẤU HÌNH
// ============================================================
const CONFIG = {
  SEND_INTERVAL: 4000,         // ⏱️ 4 giây — an toàn tuyệt đối với Telegram
  ANTI_DUPLICATE_MS: 90 * 1000, // Chặn 90 giây — đủ chắc chắn
  MAX_QUEUE_SIZE: 10,
  MAX_RETRY: 2                  // Giảm số lần thử lại
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
  if (employeeNames[normalizedCode]) {
    return employeeNames[normalizedCode];
  }
  const numPart = normalizedCode.replace(/^EMP/, '');
  for (const [key, name] of Object.entries(employeeNames)) {
    if (key.endsWith(numPart)) return name;
  }
  return `Chưa cập nhật (${normalizedCode})`;
}

// ============================================================
// 📦 HÀNG ĐỢI — SỬA CHẶN TRÙNG NGAY TỪ ĐẦU
// ============================================================
const messageQueue = [];
let isProcessingQueue = false;
const sentKeysToday = new Set(); // Khóa đã gửi hôm nay

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escapeMarkdown(text) {
  return String(text)
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/`/g, '\\`');
}

function getTodayKey() {
  return new Date().toISOString().split('T')[0];
}

function addToQueue(telegramText, embed, uniqueKey) {
  // === CHẶN NGAY: ĐÃ GỬI RỒI → BỎ QUA HOÀN TOÀN ===
  if (sentKeysToday.has(uniqueKey)) {
    console.log(`🚫 ĐÃ GỬI RỒI, BỎ QUA: ${uniqueKey}`);
    return false;
  }

  if (messageQueue.length >= CONFIG.MAX_QUEUE_SIZE) {
    console.log('⚠️ Hàng đợi đầy, bỏ qua');
    return false;
  }

  // Đánh dấu NGAY khi nhận — không chờ gửi xong
  sentKeysToday.add(uniqueKey);
  messageQueue.push({ telegramText, embed, uniqueKey, retryCount: 0 });
  console.log(`✅ Đưa vào hàng đợi: ${uniqueKey}`);
  
  if (!isProcessingQueue) processQueue();
  return true;
}

async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  return await axios.post(url, {
    chat_id: TELEGRAM_CHAT_ID,
    text: text,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true
  });
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
      console.log(`📱 Telegram ✅ GỬI XONG: ${uniqueKey}`);

      if (DISCORD_WEBHOOK_URL) {
        await sendDiscord(embed);
        console.log(`💬 Discord ✅ GỬI XONG: ${uniqueKey}`);
      }

    } catch (e) {
      const status = e.response?.status;
      const retryAfter = (e.response?.data?.parameters?.retry_after || 5) * 1000;

      if (status === 429 && retryCount < CONFIG.MAX_RETRY) {
        console.log(`⚠️ Giới hạn, thử lại (${retryCount+1}/${CONFIG.MAX_RETRY}) sau ${retryAfter/1000}s...`);
        item.retryCount++;
        messageQueue.unshift(item);
        await sleep(retryAfter);
        continue;
      }

      // Thất bại cuối cùng → MỞ KHÓA để thử lại sau
      sentKeysToday.delete(uniqueKey);
      console.error(`❌ Thất bại hoàn toàn ${uniqueKey}:`, e.response?.data?.description || e.message);
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
// 🎨 TẠO NỘI DUNG THÔNG BÁO
// ============================================================
function buildMessages(name, time, isCheckin, code) {
  const now = new Date();
  const timeFooter = formatTimeFooter(now);
  const safeName = escapeMarkdown(name);
  const safeCode = escapeMarkdown(code);
  const safeTime = escapeMarkdown(time);
  const safeFooter = escapeMarkdown(`Hệ thống chấm công DAHAHI · ${timeFooter}`);

  const telegramText = isCheckin
    ? `✅ *NHÂN VIÊN VÀO CA*\n\n👤 Họ tên: *${safeName}*\n🆔 Mã: \`${safeCode}\`\n⏰ Thời gian: ${safeTime}\n\n_${safeFooter}_`
    : `🏠 *NHÂN VIÊN RA CA*\n\n👤 Họ tên: *${safeName}*\n🆔 Mã: \`${safeCode}\`\n⏰ Thời gian: ${safeTime}\n\n_${safeFooter}_`;

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
    employeeState[code] = { date: today, lastType: null, lastCheckTime: 0 };
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
// 📥 NHẬN DỮ LIỆU — CHẶN LIỀN TAY TẠI ĐẦU VÀO
// ============================================================
const recentChecks = new Map();

app.post('/webhook/dahahi', async (req, res) => {
  try {
    const p = req.body;
    const rawCode = p.EmployeeCode || p.FacePersonId || p.id || p.employee_id;

    console.log('📥 Nhận dữ liệu:', p.EmployeeCode || p.FacePersonId);

    if (!rawCode) {
      return res.status(400).json({ error: 'Thiếu mã nhân viên' });
    }

    const normalizedCode = normalizeEmployeeCode(rawCode);
    if (!normalizedCode) {
      return res.status(400).json({ error: 'Mã không hợp lệ' });
    }

    // === CHẶN GỌI NHIỀU LẦN TRONG 90 GIÂY ===
    const nowMs = Date.now();
    if (recentChecks.has(normalizedCode)) {
      const gap = nowMs - recentChecks.get(normalizedCode);
      if (gap < CONFIG.ANTI_DUPLICATE_MS) {
        console.log(`🚫 Bỏ qua (${Math.round(gap/1000)}s < 90s): ${normalizedCode}`);
        return res.json({ note: 'Đã chấm gần đây, bỏ qua' });
      }
    }
    recentChecks.set(normalizedCode, nowMs);

    // === XÁC ĐỊNH VÀO/RA ===
    const isCheckin = determineCheckType(normalizedCode);
    const today = getTodayKey();
    const uniqueKey = `${normalizedCode}-${today}-${isCheckin ? 'in' : 'out'}`;

    // === CHẶN TIẾP NỮA: ĐÃ GỬI THÌ DỪNG ===
    if (sentKeysToday.has(uniqueKey)) {
      console.log(`🚫 Đã gửi rồi, bỏ qua: ${uniqueKey}`);
      return res.json({ note: 'Đã thông báo, không gửi lại' });
    }

    // === LẤY TÊN & TẠO NỘI DUNG ===
    const empName = p.EmployeeName || findEmployeeName(normalizedCode);
    const timeStr = p.CheckinTime || p.Time || new Date().toLocaleString('vi-VN');
    
    const { telegramText, embed } = buildMessages(empName, timeStr, isCheckin, normalizedCode);
    
    // === GỬI ===
    const added = addToQueue(telegramText, embed, uniqueKey);

    res.json({
      ok: true,
      name: empName,
      code: normalizedCode,
      type: isCheckin ? 'VÀO CA' : 'RA CA',
      sent: added
    });

  } catch (e) {
    console.error('❌ Lỗi:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 🧪 KIỂM TRA
// ============================================================
app.get('/test-telegram', (req, res) => {
  sentKeysToday.clear();
  res.json({ ok: true, message: '✅ Đã reset khóa chống trùng — chấm thử lại' });
});

// ============================================================
// 🚀 KHỞI ĐỘNG
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('=========================================');
  console.log(`🚀 SERVER ĐANG CHẠY CỔNG: ${PORT}`);
  console.log(`🤖 Telegram: Đã kết nối`);
  console.log(`🛡️ Chặn trùng: 90s + khóa ngay từ đầu`);
  console.log(`⏱️ Gửi cách 4s — chống giới hạn 429`);
  console.log('=========================================');
});
