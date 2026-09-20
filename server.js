const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '10mb' }));

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

console.log('🔑 Webhook URL:', DISCORD_WEBHOOK_URL ? '✅ Đã cấu hình' : '❌ THIẾU URL!');

// ===== LƯU TRẠNG THÁI =====
// lastStatus[maNV] = { date: '2026-09-20', isCheckin: true/false }
const lastStatus = {};

// ===== DANH SÁCH NHÂN VIÊN =====
const employeeNames = {
  const employeeNames = {
  // === QUẢN LÝ ===
  'EMP00000003': 'Dương Nhất Vy',

  // === NHÂN VIÊN ===
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
};

// ===== KIỂM TRA SAU 7:30 SÁNG KHÔNG =====
function isAfterResetTime() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  // Trả về true nếu >= 7:30
  return hours > 7 || (hours === 7 && minutes >= 30);
}

function getToday() {
  return new Date().toISOString().split('T')[0]; // '2026-09-20'
}

// ===== GỬI TIN DISCORD =====
async function sendDiscord(embed) {
  try {
    console.log('📤 Đang gửi Discord...');
    await axios.post(DISCORD_WEBHOOK_URL, {
      embeds: [embed],
      username: 'Bot Chấm Công'
    });
    console.log('✅ Gửi Discord THÀNH CÔNG!');
    return true;
  } catch (e) {
    console.error('❌ Lỗi gửi Discord:', e.response?.status || e.message);
    return false;
  }
}

// ===== TẠO TIN NHẮN =====
function buildEmbed(name, time, isCheckin) {
  return {
    title: isCheckin ? '▶ NHÂN VIÊN VÀO CA' : '■ NHÂN VIÊN RA CA',
    color: isCheckin ? 5763719 : 15548997,
    fields: [
      { name: '👤 Nhân viên', value: `**${name}**`, inline: true },
      { name: '⏰ Thời gian', value: time || '—', inline: true },
      { name: '📍 Thiết bị', value: 'Máy chấm công', inline: false }
    ],
    footer: { text: 'Hệ thống chấm công DAHAHI' },
    timestamp: new Date().toISOString()
  };
}

// ===== XỬ LÝ WEBHOOK =====
app.post('/webhook/dahahi', async (req, res) => {
  try {
    const p = req.body;
    
    console.log('\n' + '═'.repeat(60));
    console.log('📩 NHẬN DỮ LIỆU TỪ DAHAHI:');
    console.log(JSON.stringify(p, null, 2));
    console.log('═'.repeat(60));

    // === ĐỌC DỮ LIỆU ===
    const code = p.EmployeeCode || p.FacePersonId;
    const empName = p.EmployeeName || employeeNames[code] || `Mã: ${code}`;
    const time = p.CheckinTime || new Date().toLocaleString('vi-VN');
    const today = getToday();
    const afterReset = isAfterResetTime();

    if (!code) {
      console.log('⚠️ KHÔNG TÌM THẤY MÃ NHÂN VIÊN!');
      return res.status(200).json({ ok: false, note: 'Thiếu mã nhân viên' });
    }

    // === KIỂM TRA RESET ===
    const prev = lastStatus[code];
    let isCheckin;

    if (afterReset && (!prev || prev.date !== today)) {
      // Sau 7:30 sáng + ngày mới → BẮT ĐẦU TỪ VÀO CA
      isCheckin = true;
      console.log(`🌅 Sau 7:30 sáng / Ngày mới → Reset về Vào ca`);
    } else if (!afterReset && prev && prev.date === today) {
      // Trước 7:30 + cùng ngày → Tiếp tục luân phiên
      isCheckin = !prev.isCheckin;
      console.log(`🌙 Trước 7:30 sáng → Tiếp tục: ${prev.isCheckin ? 'Vào' : 'Ra'} → ${isCheckin ? 'Vào' : 'Ra'}`);
    } else {
      // Lần đầu / trước 7:30 chưa có dữ liệu → Bắt đầu Vào ca
      isCheckin = true;
      console.log(`🔄 Lần đầu chấm → Bắt đầu từ Vào ca`);
    }

    // Lưu trạng thái mới
    lastStatus[code] = { date: today, isCheckin };
    const typeText = isCheckin ? '▶ VÀO CA' : '■ RA CA';

    console.log(`✅ ${typeText} -> ${empName} | Lần tiếp theo: ${isCheckin ? 'Ra ca' : 'Vào ca'}`);

    // Gửi Discord
    const embed = buildEmbed(empName, time, isCheckin);
    await sendDiscord(embed);

    res.json({ 
      ok: true, 
      type: isCheckin ? 'checkin' : 'checkout', 
      employee: empName,
      nextTime: isCheckin ? 'Ra ca' : 'Vào ca'
    });
  } catch (e) {
    console.error('❌ LỖI XỬ LÝ:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== XEM TRẠNG THÁI =====
app.get('/status', (req, res) => {
  const today = getToday();
  const afterReset = isAfterResetTime();
  const result = {};
  for (const [code, info] of Object.entries(lastStatus)) {
    const note = info.date !== today ? '(Ngày mới sẽ reset sau 7:30)' : '';
    result[code] = `${info.isCheckin ? 'Lần cuối: Vào' : 'Lần cuối: Ra'} ${note} → Tiếp theo: ${info.isCheckin ? 'Ra' : 'Vào'}`;
  }
  res.json({ 
    today, 
    resetTime: '07:30 sáng',
    currentStatus: afterReset ? 'Đã vào giờ reset' : 'Chưa đến giờ reset',
    data: result 
  });
});

// ===== TEST =====
app.get('/test', async (req, res) => {
  try {
    if (!DISCORD_WEBHOOK_URL) {
      return res.send('❌ THIẾU biến DISCORD_WEBHOOK_URL!');
    }
    await sendDiscord(buildEmbed('Dương Nhất Vy', '20/09/2026 07:30:00', true));
    await sendDiscord(buildEmbed('Dương Nhất Vy', '20/09/2026 18:00:00', false));
    res.send('✅ Đã cập nhật! Reset tự động lúc 7:30 sáng mỗi ngày!');
  } catch (e) {
    res.status(500).send('❌ Lỗi: ' + e.message);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server chạy trên cổng ${PORT}`);
  console.log(`📅 Ngày hôm nay: ${getToday()}`);
  console.log(`⏰ Giờ reset: 07:30 sáng`);
  console.log(`🕐 Hiện tại: ${isAfterResetTime() ? 'Đã qua giờ reset' : 'Chưa đến giờ reset'}`);
});
