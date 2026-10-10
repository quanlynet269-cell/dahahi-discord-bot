const express = require('express');
const axios = require('axios');
require('dotenv').config();
const app = express();
app.use(express.json({ limit: '10mb' }));

// ============================================================
// ⚙️ CẤU HÌNH
// ============================================================
const CONFIG = {
  ANTI_DUPLICATE_MS: 90 * 1000, // Chặn gửi trùng trong 90 giây
  SEND_INTERVAL: 3000,          // Gửi cách 3 giây tránh bị giới hạn
  MAX_RETRY: 3,                 // Thử lại tối đa 3 lần
  RETRY_DELAY: 5000             // Chờ 5 giây trước khi thử lại
};

// ============================================================
// 🔑 KIỂM TRA BIẾN MÔI TRƯỜNG
// ============================================================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

console.log('=========================================');
console.log('🔍 KIỂM TRA CẤU HÌNH:');
console.log(`🤖 TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN ? '✅ Đã có' : '❌ Thiếu'}`);
console.log(`💬 TELEGRAM_CHAT_ID:   ${TELEGRAM_CHAT_ID ? '✅ Đã có' : '❌ Thiếu'}`);
console.log('=========================================\n');

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('❌ Thiếu thông tin Telegram! Vui lòng kiểm tra biến môi trường trên Render.');
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

function findEmployeeName(normalizedCode) {
  if (employeeNames[normalizedCode]) return employeeNames[normalizedCode];
  const numPart = normalizedCode.replace(/^EMP/, '');
  for (const [key, name] of Object.entries(employeeNames)) {
    if (key.endsWith(numPart)) return name;
  }
  return `Chưa cập nhật (${normalizedCode})`;
}

// ============================================================
// 📤 GỬI TELEGRAM — CHỈ DÙNG CHO CHẤM CÔNG
// ============================================================
let lastSendTime = 0;
let isSending = false; // Khóa chống gửi chồng chéo

async function sendTelegram(text, attempt = 1) {
  if (isSending) {
    console.log('⏭️ Đang gửi → Bỏ qua yêu cầu trùng');
    return { success: false, skipped: true };
  }

  const now = Date.now();
  const timeSinceLast = now - lastSendTime;
  if (timeSinceLast < CONFIG.SEND_INTERVAL) {
    await sleep(CONFIG.SEND_INTERVAL - timeSinceLast);
  }

  isSending = true;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  // ✅ Buộc dùng IPv4 — tránh lỗi kết nối
  const axiosConfig = {
    timeout: 25000,
    family: 4,
    headers: { 'Connection': 'keep-alive' }
  };

  try {
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    }, axiosConfig);
    
    lastSendTime = Date.now();
    console.log(`✅ Đã gửi thành công (lần thử ${attempt})`);
    return { success: true };

  } catch (e) {
    const status = e.response?.status;
    const errMsg = e.response?.data?.description || e.message;
    
    console.log(`⚠️ Lỗi lần ${attempt}/${CONFIG.MAX_RETRY + 1}: ${errMsg}`);

    if (status === 429) {
      const retryAfter = e.response?.data?.parameters?.retry_after || 5;
      await sleep(retryAfter * 1000);
    } else if (attempt <= CONFIG.MAX_RETRY) {
      await sleep(CONFIG.RETRY_DELAY);
    }

    if (attempt <= CONFIG.MAX_RETRY) {
      isSending = false;
      return sendTelegram(text, attempt + 1);
    }

    console.log(`❌ Thất bại sau ${CONFIG.MAX_RETRY + 1} lần thử`);
    console.log(`💡 Nếu lặp lại → chạy trên máy dùng PM2`);
    return { error: true, status, message: errMsg };

  } finally {
    isSending = false;
  }
}

// ============================================================
// 🎨 TẠO NỘI DUNG THÔNG BÁO CHẤM CÔNG
// ============================================================
function buildMessage(name, time, isCheckin, code) {
  const now = new Date();
  const timeFooter = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  
  return isCheckin
    ? `<b>✅ NHÂN VIÊN VÀO CA</b>\n\n👤 Họ tên: <b>${name}</b>\n🆔 Mã: <code>${code}</code>\n⏰ Thời gian: ${time}\n\n<i>Hệ thống chấm công DAHAHI · ${timeFooter}</i>`
    : `<b>🏠 NHÂN VIÊN RA CA</b>\n\n👤 Họ tên: <b>${name}</b>\n🆔 Mã: <code>${code}</code>\n⏰ Thời gian: ${time}\n\n<i>Hệ thống chấm công DAHAHI · ${timeFooter}</i>`;
}

// ============================================================
// 📊 TRẠNG THÁI & CHỐNG TRÙNG
// ============================================================
const employeeState = {};
const sentUniqueKeys = new Set();
const recentChecks = new Map();

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

    const nowMs = Date.now();
    if (recentChecks.has(normalizedCode)) {
      const gap = nowMs - recentChecks.get(normalizedCode);
      if (gap < CONFIG.ANTI_DUPLICATE_MS) {
        console.log(`🚫 BỎ QUA (cách ${Math.round(gap/1000)}s < 90s): ${normalizedCode}`);
        return res.json({ note: 'Đã chấm gần đây' });
      }
    }
    recentChecks.set(normalizedCode, nowMs);

    const isCheckin = determineCheckType(normalizedCode);
    const uniqueKey = `${normalizedCode}-${getTodayKey()}-${isCheckin ? 'IN' : 'OUT'}`;

    if (sentUniqueKeys.has(uniqueKey)) {
      console.log(`🚫 ĐÃ GỬI TRƯỚC → BỎ QUA: ${uniqueKey}`);
      return res.json({ note: 'Đã thông báo' });
    }

    const empName = p.EmployeeName || findEmployeeName(normalizedCode);
    const timeStr = p.CheckinTime || p.Time || new Date().toLocaleString('vi-VN');
    const message = buildMessage(empName, timeStr, isCheckin, normalizedCode);
    const result = await sendTelegram(message);
    
    if (result.success) {
      sentUniqueKeys.add(uniqueKey);
      console.log(`✅ HOÀN THÀNH: ${empName} | ${isCheckin ? 'VÀO CA' : 'RA CA'}`);
    }

    res.json({
      ok: result.success,
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
// 🧪 GIỮ KẾT NỐI — KHÔNG GỬI TIN TELEGRAM ⭐
// ============================================================
app.get('/test-telegram', (req, res) => {
  console.log('🔗 UptimeRobot ping → Giữ máy không ngủ (không gửi tin)');
  res.json({
    success: true,
    message: '✅ Đang hoạt động — Giữ kết nối thành công'
  });
});

// ============================================================
// 🚀 KHỞI ĐỘNG
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('=========================================');
  console.log(`🚀 Server chạy cổng: ${PORT}`);
  console.log(`🤖 Chỉ gửi Telegram khi có chấm công`);
  console.log(`🛡️ UptimeRobot giữ máy — KHÔNG gửi tin rác ✅`);
  console.log(`📥 Webhook: /webhook/dahahi`);
  console.log('=========================================\n');
});
