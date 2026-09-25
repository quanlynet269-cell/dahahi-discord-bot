const express = require('express');
const axios = require('axios');
require('dotenv').config();
const app = express();
app.use(express.json({ limit: '10mb' }));

// ============================================================
// ⚙️ CẤU HÌNH
// ============================================================
const CONFIG = {
  SEND_INTERVAL: 3500,
  ANTI_DUPLICATE_MS: 2 * 60 * 1000,
  MAX_QUEUE_SIZE: 30,
  MAX_RETRY: 3
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
  let str = String(code).trim();
  if (str.toUpperCase().startsWith('EMP')) {
    return str.toUpperCase();
  }
  return `EMP${str.padStart(8, '0')}`;
}

// ============================================================
// 📦 HÀNG ĐỢI — CHỐNG 429
// ============================================================
const messageQueue = [];
let isProcessingQueue = false;
const processedKeys = new Set();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function addToQueue(embed, uniqueKey) {
  if (processedKeys.has(uniqueKey)) {
    console.log(`⏭️ Bỏ qua trùng: ${uniqueKey}`);
    return false;
  }
  if (messageQueue.length >= CONFIG.MAX_QUEUE_SIZE) {
    console.log('⚠️ Hàng đợi đầy, bỏ qua');
    return false;
  }
  messageQueue.push({ embed, uniqueKey, retryCount: 0 });
  processedKeys.add(uniqueKey);
  if (!isProcessingQueue) processQueue();
  return true;
}

async function processQueue() {
  isProcessingQueue = true;
  while (messageQueue.length > 0) {
    const item = messageQueue.shift();
    const { embed, uniqueKey, retryCount } = item;
    
    try {
      await axios.post(DISCORD_WEBHOOK_URL, {
        embeds: [embed],
        username: 'Bot Chấm Công'
      });
      console.log(`✅ Gửi thành công: ${uniqueKey} — Còn: ${messageQueue.length}`);
      processedKeys.delete(uniqueKey);
      
    } catch (e) {
      if (e.response?.status === 429) {
        const retryAfter = (e.response.data?.retry_after || 5) * 1000;
        if (retryCount < CONFIG.MAX_RETRY) {
          console.log(`⚠️ 429 — Thử lại ${retryCount+1}/${CONFIG.MAX_RETRY} sau ${retryAfter/1000}s...`);
          item.retryCount++;
          messageQueue.unshift(item);
          await sleep(retryAfter);
          continue;
        } else {
          console.log(`❌ Thất bại sau ${CONFIG.MAX_RETRY} lần: ${uniqueKey}`);
          processedKeys.delete(uniqueKey);
        }
      } else {
        console.error(`❌ Lỗi ${uniqueKey}:`, e.response?.status || e.message);
        processedKeys.delete(uniqueKey);
      }
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
  return `Hôm nay lúc ${displayH}:${m} ${period}`;
}

// ============================================================
// 🎨 TẠO NỘI DUNG THÔNG BÁO
// ============================================================
function buildEmbed(name, time, isCheckin, code) {
  const now = new Date();
  const title = isCheckin ? '✅ NHÂN VIÊN VÀO CA' : '🏠 NHÂN VIÊN RA CA';
  const desc = isCheckin
    ? `**${name}** đã bắt đầu ca làm việc`
    : `**${name}** đã kết thúc ca làm việc`;
  
  return {
    title: title,
    description: desc,
    color: isCheckin ? 0x2ecc71 : 0xe67e22,
    fields: [
      { name: '👤 Họ và tên', value: name, inline: true },
      { name: '🆔 Mã nhân viên', value: `\`${code}\``, inline: true },
      { name: '⏰ Thời gian', value: time, inline: true }
    ],
    footer: {
      text: `Hệ thống chấm công DAHAHI • Tối ưu chống lỗi 429 • ${formatTimeFooter(now)}`
    },
    timestamp: now.toISOString()
  };
}

// ============================================================
// 📊 TRẠNG THÁI — THEO DÕI VÀO/RA CHÍNH XÁC
// ============================================================
const todayStatus = {}; // { [maNhanVien]: { lastAction: 'in'|'out', timeStamp: number } }
const recentRequests = new Map();

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function isDuplicateCheck(code) {
  const now = Date.now();
  if (recentRequests.has(code)) {
    if (now - recentRequests.get(code) < CONFIG.ANTI_DUPLICATE_MS) {
      return true;
    }
  }
  recentRequests.set(code, now);
  return false;
}

// Xác định vào ca hay ra ca DỰA TRẠNG THÁI TRƯỚC
function determineCheckType(code) {
  const today = getToday();
  const key = `${today}-${code}`;
  
  if (!todayStatus[key]) {
    // Lần đầu trong ngày → VÀO CA
    todayStatus[key] = { lastAction: 'in', time: Date.now() };
    return true; // isCheckin = true
  }
  
  // Đã có bản ghi → đảo ngược trạng thái
  const prevAction = todayStatus[key].lastAction;
  const nextAction = prevAction === 'in' ? 'out' : 'in';
  todayStatus[key] = { lastAction: nextAction, time: Date.now() };
  
  return nextAction === 'in';
}

// ============================================================
// 📥 NHẬN DỮ LIỆU TỪ WEBHOOK
// ============================================================
app.post('/webhook/dahahi', async (req, res) => {
  try {
    const p = req.body;
    
    // Lấy mã từ các trường có thể có
    const rawCode = p.EmployeeCode || p.FacePersonId || p.id || p.employee_id;
    if (!rawCode) {
      console.log('❌ Dữ liệu nhận:', JSON.stringify(p, null, 2));
      return res.status(400).json({ error: 'Thiếu mã nhân viên' });
    }
    
    const normalizedCode = normalizeEmployeeCode(rawCode);
    console.log(`📥 Nhận: mã gốc=${rawCode} → chuẩn hóa=${normalizedCode}`);
    
    if (!normalizedCode) {
      return res.status(400).json({ error: 'Mã không hợp lệ' });
    }
    
    // Chống trùng
    if (isDuplicateCheck(normalizedCode)) {
      return res.json({ note: 'Bỏ qua trùng lặp' });
    }
    
    // Tìm tên
    const empName = employeeNames[normalizedCode] || `Chưa cập nhật (${normalizedCode})`;
    const timeStr = p.CheckinTime || p.Time || new Date().toLocaleString('vi-VN');
    
    // Xác định VÀO CA hay RA CA
    const isCheckin = determineCheckType(normalizedCode);
    const today = getToday();
    const uniqueKey = `${normalizedCode}-${today}-${isCheckin ? 'in' : 'out'}`;
    
    // Gửi thông báo
    addToQueue(buildEmbed(empName, timeStr, isCheckin, normalizedCode), uniqueKey);
    
    res.json({
      ok: true,
      name: empName,
      code: normalizedCode,
      type: isCheckin ? 'VÀO CA' : 'RA CA'
    });
  } catch (e) {
    console.error('❌ Lỗi xử lý:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 🧪 KIỂM TRA
// ============================================================
app.get('/test-send', (req, res) => {
  const uniqueKey = 'test-send-' + Date.now();
  addToQueue(buildEmbed('Lâm Phước Hội', '25/09/2026 17:17:18', true, 'EMP00000036'), uniqueKey);
  res.json({ ok: true, message: '✅ Đã gửi tin thử VÀO CA — Kiểm tra Discord!' });
});

// ============================================================
// 🚀 KHỞI ĐỘNG
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('=========================================');
  console.log(`🚀 SERVER ĐANG CHẠY CỔNG: ${PORT}`);
  console.log(`✅ Đã sửa: Hiện tên NV + Phân biệt VÀO/RA CA`);
  console.log(`✅ Chống lỗi 429 & chống trùng lặp`);
  console.log('=========================================');
});
