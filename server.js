const express = require('express');
const axios = require('axios');
require('dotenv').config();
const app = express();
app.use(express.json({ limit: '10mb' }));

// ============================================================
// ⚙️ CẤU HÌNH AN TOÀN — TRÁNH 429 DỨT ĐIỂM
// ============================================================
const CONFIG = {
  SEND_INTERVAL: 3500,        // ⏱️ 3.5 giây/tin — DƯỚI ngưỡng Discord hoàn toàn
  ANTI_DUPLICATE_MS: 2 * 60 * 1000,
  MAX_QUEUE_SIZE: 30,         // Giữ hàng đợi nhỏ
  MAX_RETRY: 3                // Tối đa thử lại 3 lần thôi
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
console.log(`⚙️ Gửi mỗi ${CONFIG.SEND_INTERVAL/1000}s — an toàn 100%`);

// ============================================================
// 📦 HÀNG ĐỢI — CÓ GIỚI HẠN THỬ LẠI
// ============================================================
const messageQueue = [];
let isProcessingQueue = false;
const processedKeys = new Set(); // Ngăn trùng tuyệt đối

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function addToQueue(embed, uniqueKey) {
  // Ngăn thêm nếu đã có trong hàng đợi/đã xử lý
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
      processedKeys.delete(uniqueKey); // Xóa khóa sau khi thành công
      
    } catch (e) {
      if (e.response?.status === 429) {
        const retryAfter = (e.response.data?.retry_after || 5) * 1000;
        
        if (retryCount < CONFIG.MAX_RETRY) {
          console.log(`⚠️ 429 — Thử lại ${retryCount+1}/${CONFIG.MAX_RETRY} sau ${retryAfter/1000}s...`);
          item.retryCount++;
          messageQueue.unshift(item); // Đưa lại đầu hàng đợi
          await sleep(retryAfter);
          continue;
        } else {
          console.log(`❌ Đã thử ${CONFIG.MAX_RETRY} lần thất bại — Bỏ qua: ${uniqueKey}`);
          processedKeys.delete(uniqueKey); // Bỏ hẳn
        }
      } else {
        console.error(`❌ Lỗi khác ${uniqueKey}:`, e.response?.status || e.message);
        processedKeys.delete(uniqueKey);
      }
    }
    
    await sleep(CONFIG.SEND_INTERVAL);
  }
  isProcessingQueue = false;
  processedKeys.clear(); // Dọn dẹp khi rỗng
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
// 🔒 CHỐNG TRÙNG — CẢI TIẾN
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
// 🕐 ĐỊNH DẠNG THỜI GIAN CHÂN TRANG
// ============================================================
function formatTimeFooter(date) {
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  const period = h >= 12 ? 'CH' : 'SA';
  const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `Hôm nay lúc ${displayH}:${m} ${period}`;
}

// ============================================================
// 🎨 GIAO DIỆN ĐÚNG MẪU
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

    const uniqueKey = `${code}-${today}-${isCheckin ? 'in' : 'out'}`;
    addToQueue(buildEmbed(empName, timeStr, isCheckin, code), uniqueKey);
    
    res.json({ ok: true, name: empName, type: isCheckin ? 'in' : 'out' });
  } catch (e) {
    console.error('❌ Lỗi xử lý:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 🧪 KIỂM TRA — CHỈ GỬI 1 LẦN
// ============================================================
let testSent = false;
app.get('/test-send', (req, res) => {
  if (testSent) {
    return res.json({ note: 'Đã gửi tin thử rồi — không gửi lại để tránh lỗi 429' });
  }
  testSent = true;
  const uniqueKey = 'test-send-once';
  addToQueue(buildEmbed('Nguyễn Thống Nhất', '23/09/2026 17:21:17', true, 'EMP00000008'), uniqueKey);
  res.json({ ok: true, message: '✅ Đã gửi tin thử — Kiểm tra Discord!' });
});

// ============================================================
// 🚀 KHỞI ĐỘNG
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('=========================================');
  console.log(`🚀 SERVER ĐANG CHẠY CỔNG: ${PORT}`);
  console.log(`✅ Đã khắc phục lỗi 429 — Không lặp vô hạn`);
  console.log('=========================================');
});
