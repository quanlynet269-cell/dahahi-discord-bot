const express = require('express');
const axios = require('axios');
require('dotenv').config();
const app = express();
app.use(express.json({ limit: '10mb' }));

// ============================================================
// ⚙️ CẤU HÌNH TỐI ƯU - CHỈNH SỬA Ở ĐÂY NẾU CẦN
// ============================================================
const CONFIG = {
  // Thời gian đợi giữa các lần gửi (mili giây)
  // 2500 = 2.5s → 24 tin/phút (an toàn tuyệt đối, vẫn nhanh)
  // 2000 = 2s → 30 tin/phút (ngưỡng giới hạn, không khuyến nghị)
  // 3000 = 3s → 20 tin/phút (an toàn nhất, hơi chậm chút)
  SEND_INTERVAL: 2500,
  
  // Thời gian chống trùng cùng nhân viên (mili giây)
  // 2 * 60 * 1000 = 2 phút
  ANTI_DUPLICATE_MS: 2 * 60 * 1000,
  
  // Giới hạn hàng đợi (tránh quá tải)
  MAX_QUEUE_SIZE: 100,
  
  // Thời gian chờ tối đa khi lỗi 429 (giây)
  MAX_RETRY_AFTER: 120,
};

// ============================================================
// 🔑 KIỂM TRA WEBHOOK
// ============================================================
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
if (!DISCORD_WEBHOOK_URL) {
  console.error('❌❌❌ THIẾU DISCORD_WEBHOOK_URL! Vào Render → Environment thêm biến này.');
  process.exit(1);
}
console.log('🔑 Webhook URL: ✅ Đã cấu hình');
console.log(`⚙️ Gửi 1 tin mỗi ${CONFIG.SEND_INTERVAL / 1000}s → ${Math.round(60000 / CONFIG.SEND_INTERVAL)} tin/phút`);

// ============================================================
// 📦 HỆ THỐNG HÀNG ĐỢI THÔNG MINH (TỐI ƯU NHẤT)
// ============================================================
const messageQueue = [];
let isProcessingQueue = false;
let discordBlockedUntil = 0; // Thời điểm Discord mở khóa

// Hàm đợi
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Kiểm tra xem Discord có đang chặn không
function isDiscordBlocked() {
  return Date.now() < discordBlockedUntil;
}

// Thêm tin vào hàng đợi
function addToQueue(embed) {
  if (messageQueue.length >= CONFIG.MAX_QUEUE_SIZE) {
    console.error(`⚠️ Hàng đợi đầy (${CONFIG.MAX_QUEUE_SIZE} tin) → Bỏ qua tin mới nhất!`);
    return false;
  }
  
  messageQueue.push({
    embed,
    addedAt: Date.now(),
    retryCount: 0
  });
  
  const position = messageQueue.length;
  const estimatedWait = (position - 1) * (CONFIG.SEND_INTERVAL / 1000);
  console.log(`➕ Thêm hàng đợi. Vị trí: ${position} | Ước tính đợi: ${estimatedWait}s`);
  
  // Kích hoạt xử lý hàng đợi
  if (!isProcessingQueue) {
    processQueue();
  }
  
  return true;
}

// Xử lý hàng đợi tự động
async function processQueue() {
  if (isProcessingQueue) return;
  if (messageQueue.length === 0) return;
  
  isProcessingQueue = true;
  console.log(`📦 Bắt đầu xử lý hàng đợi: ${messageQueue.length} tin chờ`);
  
  while (messageQueue.length > 0) {
    // Nếu Discord đang chặn → đợi đến khi hết
    if (isDiscordBlocked()) {
      const waitMs = discordBlockedUntil - Date.now() + 1000;
      const waitSec = Math.ceil(waitMs / 1000);
      console.log(`⏳ Discord đang chặn, đợi ${waitSec}s nữa...`);
      await sleep(Math.min(waitMs, 30000)); // Đợi tối đa 30s rồi kiểm tra lại
      continue;
    }
    
    const item = messageQueue.shift();
    
    try {
      await sendDiscordDirect(item.embed);
      const waitSec = ((Date.now() - item.addedAt) / 1000).toFixed(1);
      console.log(`✅ Gửi thành công! (chờ ${waitSec}s trong hàng đợi) | Còn lại: ${messageQueue.length}`);
    } catch (e) {
      const status = e.response?.status;
      
      if (status === 429) {
        // Lỗi 429 → Đọc thời gian chặn từ Discord
        const retryAfter = Math.min(
          parseInt(e.response?.headers?.['retry-after']) || 60,
          CONFIG.MAX_RETRY_AFTER
        );
        discordBlockedUntil = Date.now() + retryAfter * 1000;
        console.log(`🔒 Discord chặn ${retryAfter}s → Đến ${new Date(discordBlockedUntil).toLocaleTimeString('vi-VN')}`);
        
        // Đưa tin này lại đầu hàng đợi để thử lại sau
        item.retryCount++;
        if (item.retryCount <= 5) {
          messageQueue.unshift(item);
          console.log(`🔄 Đưa lại hàng đợi (lần thử: ${item.retryCount}/5)`);
        } else {
          console.error(`❌ Tin nhắn bị bỏ qua sau 5 lần thử thất bại!`);
        }
        continue;
      }
      
      // Lỗi khác → thử lại tối đa 3 lần
      item.retryCount++;
      if (item.retryCount <= 3) {
        messageQueue.unshift(item);
        console.log(`⚠️ Lỗi gửi (${e.message}), thử lại lần ${item.retryCount}/3 sau 5s`);
        await sleep(5000);
        continue;
      }
      
      console.error(`❌ Bỏ qua tin nhắn sau 3 lần lỗi:`, e.message);
    }
    
    // Đợi giữa các lần gửi (LUÔN ĐỢI ĐỂ AN TOÀN)
    await sleep(CONFIG.SEND_INTERVAL);
  }
  
  isProcessingQueue = false;
  console.log('📦 Hàng đợi đã xử lý xong!');
}

// Gửi Discord trực tiếp (chỉ dùng trong hàng đợi)
async function sendDiscordDirect(embed) {
  await axios.post(DISCORD_WEBHOOK_URL, {
    embeds: [embed],
    username: 'Bot Chấm Công',
    avatar_url: '' // Có thể thêm link avatar bot nếu muốn
  });
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
// 🔄 LOGIC CHỐNG TRÙNG + XÁC ĐỊNH VÀO/RA CA
// ============================================================
const lastStatus = {};
const recentRequests = new Map();

function isAfterResetTime() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  return hours > 5 || (hours === 5 && minutes >= 30);
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

// Chống trùng cùng nhân viên trong khoảng thời gian cấu hình
function isDuplicate(code) {
  const now = Date.now();
  
  if (recentRequests.has(code)) {
    const lastTime = recentRequests.get(code);
    if (now - lastTime < CONFIG.ANTI_DUPLICATE_MS) {
      const remainSec = Math.ceil((CONFIG.ANTI_DUPLICATE_MS - (now - lastTime)) / 1000);
      console.log(`⚠️ NV [${code}] trùng trong ${CONFIG.ANTI_DUPLICATE_MS / 60000} phút → Bỏ qua (còn ${remainSec}s)`);
      return true;
    }
  }
  
  recentRequests.set(code, now);
  setTimeout(() => recentRequests.delete(code), CONFIG.ANTI_DUPLICATE_MS + 10000);
  return false;
}

// ============================================================
// 🎨 TẠO TIN NHẮN DISCORD ĐẸP (TỐI ƯU)
// ============================================================
function buildEmbed(name, time, isCheckin, employeeCode) {
  return {
    title: isCheckin ? '✅ NHÂN VIÊN VÀO CA' : '👋 NHÂN VIÊN RA CA',
    description: isCheckin 
      ? `**${name}** đã bắt đầu ca làm việc` 
      : `**${name}** đã kết thúc ca làm việc`,
    color: isCheckin ? 5763719 : 15548997, // Xanh lá / Đỏ
    fields: [
      { 
        name: '👤 Họ và tên', 
        value: `**${name}**`, 
        inline: true 
      },
      { 
        name: '🆔 Mã nhân viên', 
        value: `\`${employeeCode}\``, 
        inline: true 
      },
      { 
        name: '⏰ Thời gian', 
        value: `**${time || '—'}**`, 
        inline: true 
      }
    ],
    footer: { 
      text: 'Hệ thống chấm công DAHAHI • Tối ưu chống lỗi 429',
      icon_url: ''
    },
    timestamp: new Date().toISOString(),
    thumbnail: isCheckin 
      ? { url: 'https://cdn-icons-png.flaticon.com/512/1828/1828884.png' }
      : { url: 'https://cdn-icons-png.flaticon.com/512/1828/1828774.png' }
  };
}

// ============================================================
// 📥 API NHẬN DỮ LIỆU CHẤM CÔNG
// ============================================================
app.post('/webhook/dahahi', async (req, res) => {
  try {
    const p = req.body;
    console.log('\n' + '═'.repeat(60));
    
    const code = p.EmployeeCode || p.FacePersonId;
    const timeStr = p.CheckinTime || p.Time || new Date().toLocaleString('vi-VN');
    
    // Kiểm tra chống trùng
    if (isDuplicate(code)) {
      return res.json({ 
        ok: true, 
        note: 'duplicate_ignored',
        queued: false 
      });
    }
    
    console.log('📩 NHẬN DỮ LIỆU:', JSON.stringify(p, null, 2));
    console.log('═'.repeat(60));
    
    const empName = p.EmployeeName || employeeNames[code] || `Mã: ${code}`;
    const today = getToday();
    const afterReset = isAfterResetTime();
    
    if (!code) {
      return res.status(400).json({ ok: false, error: 'Thiếu mã nhân viên' });
    }
    
    // Xác định vào/ra ca
    const prev = lastStatus[code];
    let isCheckin;
    
    if (afterReset && (!prev || prev.date !== today)) {
      isCheckin = true;
      console.log('🌅 Buổi sáng mới → Reset trạng thái → VÀO CA');
    } else if (prev && prev.date === today) {
      isCheckin = !prev.isCheckin;
    } else {
      isCheckin = true;
    }
    
    lastStatus[code] = { date: today, isCheckin };
    console.log(`🔄 ${empName} [${code}] → ${isCheckin ? '✅ VÀO CA' : '👋 RA CA'}`);
    
    // Thêm vào hàng đợi (KHÔNG gửi ngay)
    const queued = addToQueue(buildEmbed(empName, timeStr, isCheckin, code));
    
    res.json({ 
      ok: true, 
      queued,
      queueLength: messageQueue.length,
      employee: empName,
      action: isCheckin ? 'checkin' : 'checkout'
    });
    
  } catch (e) {
    console.error('❌ LỖI XỬ LÝ:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 📊 API THEO DÕI TRẠNG THÁI (TỐI ƯU)
// ============================================================
app.get('/status', (req, res) => {
  const blocked = isDiscordBlocked();
  res.json({ 
    today: getToday(), 
    employees: lastStatus,
    queue: {
      length: messageQueue.length,
      processing: isProcessingQueue,
      maxSize: CONFIG.MAX_QUEUE_SIZE
    },
    discord: {
      blocked: blocked,
      blockedUntil: blocked ? new Date(discordBlockedUntil).toLocaleString('vi-VN') : null,
      webhookConfigured: !!DISCORD_WEBHOOK_URL
    },
    config: {
      sendInterval: `${CONFIG.SEND_INTERVAL / 1000}s`,
      ratePerMinute: Math.round(60000 / CONFIG.SEND_INTERVAL),
      antiDuplicate: `${CONFIG.ANTI_DUPLICATE_MS / 60000} phút`
    }
  });
});

// ============================================================
// 🧪 API TEST
// ============================================================
app.get('/test', (req, res) => {
  res.json({
    message: '✅ Bot chấm công đang hoạt động!',
    features: [
      'Hệ thống hàng đợi thông minh',
      `Gửi 1 tin mỗi ${CONFIG.SEND_INTERVAL / 1000}s`,
      `Chống trùng cùng NV ${CONFIG.ANTI_DUPLICATE_MS / 60000} phút`,
      'Tự động xử lý lỗi 429',
      'Tự động thử lại khi lỗi'
    ],
    endpoints: {
      status: '/status (Xem trạng thái hệ thống)',
      webhook: 'POST /webhook/dahahi (Nhận dữ liệu chấm công)',
      testSend: '/test-send (Gửi tin thử vào hàng đợi)'
    }
  });
});

// API gửi tin thử (để kiểm tra hàng đợi)
app.get('/test-send', (req, res) => {
  const testEmbed = buildEmbed('Nguyễn Văn Test', new Date().toLocaleString('vi-VN'), true, 'EMP00000999');
  const queued = addToQueue(testEmbed);
  res.json({ 
    ok: true, 
    message: queued ? '✅ Đã thêm vào hàng đợi!' : '❌ Hàng đợi đầy!',
    queueLength: messageQueue.length
  });
});

// ============================================================
// 🚀 KHỞI ĐỘNG SERVER
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('\n' + '🚀'.repeat(20));
  console.log(`🚀 SERVER ĐANG CHẠY CỔNG: ${PORT}`);
  console.log(`⚙️ Cấu hình gửi: 1 tin mỗi ${CONFIG.SEND_INTERVAL / 1000}s → ${Math.round(60000 / CONFIG.SEND_INTERVAL)} tin/phút`);
  console.log(`🛡️ Chống trùng: ${CONFIG.ANTI_DUPLICATE_MS / 60000} phút / nhân viên`);
  console.log(`📦 Hàng đợi: Tối đa ${CONFIG.MAX_QUEUE_SIZE} tin`);
  console.log(`🔒 Bảo vệ lỗi 429: TỐI ƯU HOÀN CHỈNH`);
  console.log(`📊 Trạng thái: /status`);
  console.log(`🧪 Test: /test`);
  console.log('🚀'.repeat(20) + '\n');
});
