const express = require('express');
const axios = require('axios');
require('dotenv').config();
const app = express();
app.use(express.json({ limit: '10mb' }));

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
console.log('🔑 Webhook URL:', DISCORD_WEBHOOK_URL ? '✅ Đã cấu hình' : '❌ THIẾU URL!');

// ===== LƯU TRẠNG THÁI =====
const lastStatus = {};
const recentRequests = new Map(); // Ngăn gửi trùng cùng NV trong 2 phút

// ===== HÀNG ĐỢI GỬI TIN (MỚI - QUAN TRỌNG NHẤT) ✅✅✅ =====
const messageQueue = []; // Hàng đợi chứa các tin cần gửi
let isProcessingQueue = false; // Đang xử lý hàng đợi hay chưa
const SEND_INTERVAL = 3000; // Gửi 1 tin mỗi 3 giây → 20 tin/phút (an toàn tuyệt đối)

// ===== HÀM ĐỢI =====
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== XỬ LÝ HÀNG ĐỢI TỰ ĐỘNG =====
async function processQueue() {
  if (isProcessingQueue) return; // Đang chạy rồi thì không chạy lại
  if (messageQueue.length === 0) return; // Hàng đợi rỗng thì dừng
  
  isProcessingQueue = true;
  console.log(`📦 Bắt đầu xử lý hàng đợi: còn ${messageQueue.length} tin`);
  
  while (messageQueue.length > 0) {
    const embed = messageQueue.shift(); // Lấy tin đầu tiên ra
    
    try {
      await sendDiscordDirect(embed);
      console.log(`✅ Đã gửi từ hàng đợi. Còn lại: ${messageQueue.length} tin`);
    } catch (e) {
      console.error(`❌ Gửi từ hàng đợi lỗi, đưa lại cuối hàng đợi:`, e.message);
      messageQueue.push(embed); // Thất bại → đưa lại cuối hàng đợi thử sau
      await sleep(5000); // Đợi 5 giây rồi thử tiếp
    }
    
    // ✅ LUÔN ĐỢI 3 GIÂY GIỮA CÁC LẦN GỬI → ĐẢM BẢO KHÔNG BỊ CHẶN
    await sleep(SEND_INTERVAL);
  }
  
  isProcessingQueue = false;
  console.log('📦 Hàng đợi đã xử lý xong!');
}

// ===== THÊM TIN VÀO HÀNG ĐỢI =====
function addToQueue(embed) {
  messageQueue.push(embed);
  console.log(`➕ Thêm vào hàng đợi. Vị trí: ${messageQueue.length}`);
  
  // Kích hoạt xử lý hàng đợi (nếu chưa chạy)
  if (!isProcessingQueue) {
    processQueue();
  }
}

// ===== DANH SÁCH NHÂN VIÊN =====
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

// ===== KIỂM TRA SAU 5:30 SÁNG =====
function isAfterResetTime() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  return hours > 5 || (hours === 5 && minutes >= 30);
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

// ===== CHỐNG GỬI TRÙNG: CÙNG 1 NV TRONG 2 PHÚT =====
function isDuplicate(code) {
  const now = Date.now();
  const TWO_MINUTES = 2 * 60 * 1000;
  
  if (recentRequests.has(code)) {
    const lastTime = recentRequests.get(code);
    if (now - lastTime < TWO_MINUTES) {
      const soGiay = Math.round((TWO_MINUTES - (now - lastTime)) / 1000);
      console.log(`⚠️ Nhân viên [${code}] đã gửi tin cách đây chưa đầy 2 phút → Bỏ qua! (còn ${soGiay}s)`);
      return true;
    }
  }
  
  recentRequests.set(code, now);
  setTimeout(() => recentRequests.delete(code), TWO_MINUTES + 10000);
  return false;
}

// ===== GỬI DISCORD TRỰC TIẾP (CHỈ DÙNG TRONG HÀNG ĐỢI) =====
async function sendDiscordDirect(embed) {
  try {
    await axios.post(DISCORD_WEBHOOK_URL, {
      embeds: [embed],
      username: 'Bot Chấm Công'
    });
    return true;
  } catch (e) {
    const status = e.response?.status;
    
    // Nếu bị lỗi 429 → Đợi đủ thời gian Discord yêu cầu
    if (status === 429) {
      const retryAfter = e.response?.headers?.['retry-after'] || 60;
      console.log(`⏳ Discord yêu cầu đợi ${retryAfter}s`);
      await sleep(retryAfter * 1000 + 2000);
      throw new Error(`429_wait_${retryAfter}s`);
    }
    
    throw e;
  }
}

// ===== GỬI DISCORD (Qua hàng đợi) =====
async function sendDiscord(embed) {
  addToQueue(embed);
  return true;
}

// ===== TẠO NỘI DUNG =====
function buildEmbed(name, time, isCheckin) {
  return {
    title: isCheckin ? '▶ NHÂN VIÊN VÀO CA' : '■ NHÂN VIÊN RA CA',
    color: isCheckin ? 5763719 : 15548997,
    fields: [
      { name: '👤 Nhân viên', value: '**' + name + '**', inline: true },
      { name: '⏰ Thời gian', value: time || '—', inline: true },
      { name: '📍 Thiết bị', value: 'Máy chấm công', inline: false }
    ],
    footer: { text: 'Hệ thống chấm công DAHAHI' },
    timestamp: new Date().toISOString()
  };
}

// ===== XỬ LÝ DỮ LIỆU =====
app.post('/webhook/dahahi', async (req, res) => {
  try {
    const p = req.body;
    console.log('\n' + '═'.repeat(50));
    const code = p.EmployeeCode || p.FacePersonId;
    const timeStr = p.CheckinTime || p.Time || new Date().toLocaleString('vi-VN');
    
    // === CHỐNG TRÙNG: CÙNG NV TRONG 2 PHÚT BỎ QUA ===
    if (isDuplicate(code)) {
      return res.json({ ok: true, note: 'duplicate_employee_2min', queued: false });
    }
    
    console.log('📩 NHẬN DỮ LIỆU: ' + JSON.stringify(p, null, 2));
    console.log('═'.repeat(50));
    
    const empName = p.EmployeeName || employeeNames[code] || ('Mã: ' + code);
    const today = getToday();
    const afterReset = isAfterResetTime();
    
    if (!code) {
      return res.status(200).json({ ok: false });
    }
    
    // === XÁC ĐỊNH VÀO/RA ===
    const prev = lastStatus[code];
    let isCheckin;
    
    if (afterReset && (!prev || prev.date !== today)) {
      isCheckin = true;
      console.log('🌅 Reset → Vào ca');
    } else if (prev && prev.date === today) {
      isCheckin = !prev.isCheckin;
    } else {
      isCheckin = true;
    }
    
    lastStatus[code] = { date: today, isCheckin };
    console.log('🔄 ' + empName + ' → ' + (isCheckin ? 'VÀO CA' : 'RA CA'));
    
    // ✅ THAY ĐỔI QUAN TRỌNG: Thêm vào HÀNG ĐỢI thay vì gửi ngay
    sendDiscord(buildEmbed(empName, timeStr, isCheckin));
    
    res.json({ ok: true, queued: true, queuePosition: messageQueue.length });
  } catch (e) {
    console.error('❌ LỖI:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== TRẠNG THÁI =====
app.get('/status', (req, res) => {
  res.json({ 
    today: getToday(), 
    data: lastStatus,
    queueLength: messageQueue.length,
    isProcessingQueue: isProcessingQueue
  });
});

// ===== TEST =====
app.get('/test', async (req, res) => {
  if (!DISCORD_WEBHOOK_URL) return res.send('❌ Thiếu Webhook URL');
  res.send('✅ Hệ thống hàng đợi chống lỗi 429 đã kích hoạt! Gửi 1 tin mỗi 3 giây.');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('🚀 Server cổng ' + PORT);
  console.log('🛡️ Chống gửi trùng cùng NV trong 2 phút: BẬT');
  console.log('📦 Hệ thống hàng đợi: BẬT (gửi 1 tin mỗi 3 giây)');
  console.log('🔒 Bảo vệ lỗi 429: TRIỆT ĐỂ');
});
