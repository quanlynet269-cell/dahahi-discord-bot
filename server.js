const express = require('express');
const axios = require('axios');
require('dotenv').config();
const app = express();
app.use(express.json({ limit: '10mb' }));

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
console.log('🔑 Webhook URL:', DISCORD_WEBHOOK_URL ? '✅ Đã cấu hình' : '❌ THIẾU URL!');

// ===== LƯU TRẠNG THÁI =====
const lastStatus = {};
const recentRequests = new Map(); // Ngăn gửi trùng

// ===== HÀM ĐỢI =====
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

// ===== CHỐNG GỬI TRÙNG: CÙNG 1 NV TRONG 2 PHÚT → BỎ QUA ✅✅✅ =====
function isDuplicate(code) {
  const now = Date.now();
  const TWO_MINUTES = 2 * 60 * 1000; // 2 phút = 120.000 mili giây
  
  // Kiểm tra xem nhân viên này đã gửi tin trong 2 phút qua chưa
  if (recentRequests.has(code)) {
    const lastTime = recentRequests.get(code);
    if (now - lastTime < TWO_MINUTES) {
      const soGiay = Math.round((TWO_MINUTES - (now - lastTime)) / 1000);
      console.log(`⚠️ Nhân viên [${code}] đã gửi tin cách đây chưa đầy 2 phút → Bỏ qua! (còn ${soGiay}s nữa mới cho phép)`);
      return true;
    }
  }
  
  // Ghi nhận thời gian gửi mới nhất
  recentRequests.set(code, now);
  
  // Xóa sau 2 phút 10 giây để giải phóng bộ nhớ
  setTimeout(() => recentRequests.delete(code), TWO_MINUTES + 10000);
  
  return false;
}

// ===== GỬI DISCORD =====
async function sendDiscord(embed) {
  try {
    await axios.post(DISCORD_WEBHOOK_URL, {
      embeds: [embed],
      username: 'Bot Chấm Công'
    });
    console.log('✅ Gửi thành công!');
    
    // Đợi 1.5 giây sau mỗi lần gửi → Tránh lỗi 429
    await sleep(1500);
    
    return true;
  } catch (e) {
    const status = e.response?.status;
    console.error('❌ Lỗi gửi:', status || e.message);
    
    // Nếu bị lỗi 429 → Đợi rồi thử lại 1 lần
    if (status === 429) {
      const retryAfter = e.response?.headers?.['retry-after'] || 30;
      const waitMs = retryAfter * 1000 + 1000;
      console.log(`⏳ Bị Discord chặn (429), đợi ${retryAfter}s rồi thử lại...`);
      
      await sleep(waitMs);
      
      try {
        await axios.post(DISCORD_WEBHOOK_URL, {
          embeds: [embed],
          username: 'Bot Chấm Công'
        });
        console.log('✅ Thử lại thành công!');
        await sleep(1500);
        return true;
      } catch (e2) {
        console.error('❌ Thử lại vẫn lỗi:', e2.response?.status || e2.message);
        return false;
      }
    }
    
    return false;
  }
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
    
    // === CHỐNG TRÙNG: CÙNG NV TRONG 2 PHÚT BỎ QUA ✅ ===
    if (isDuplicate(code)) {
      console.log('🔁 Bỏ qua yêu cầu (trùng nhân viên trong 2 phút)');
      return res.json({ ok: true, note: 'duplicate_employee_2min' });
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
    
    await sendDiscord(buildEmbed(empName, timeStr, isCheckin));
    
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ LỖI:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== TRẠNG THÁI =====
app.get('/status', (req, res) => {
  res.json({ today: getToday(), data: lastStatus });
});

// ===== TEST =====
app.get('/test', async (req, res) => {
  if (!DISCORD_WEBHOOK_URL) return res.send('❌ Thiếu Webhook URL');
  res.send('✅ Chống trùng nhân viên 2 phút + Chống lỗi 429 đã kích hoạt!');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('🚀 Server cổng ' + PORT);
  console.log('🛡️ Chống gửi trùng cùng NV trong 2 phút: BẬT');
  console.log('⏱️ Đợi giữa các lần gửi: 1.5s');
  console.log('🔄 Tự động thử lại khi lỗi 429: BẬT');
});
