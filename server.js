const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '10mb' }));

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

console.log('🔑 Webhook URL:', DISCORD_WEBHOOK_URL ? '✅ Đã cấu hình' : '❌ THIẾU URL!');

// ===== DANH SÁCH NHÂN VIÊN =====
const employeeNames = {
  'EMP00000003': 'Dương Nhất Vy',
  'EMP000149': 'Nguyễn Thị Huyền',
  // Thêm nhân viên khác ở đây...
};

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

// ===== XỬ LÝ WEBHOOK TỪ DAHAHI =====
app.post('/webhook/dahahi', async (req, res) => {
  try {
    const p = req.body;
    
    console.log('\n' + '═'.repeat(60));
    console.log('📩 NHẬN DỮ LIỆU TỪ DAHAHI:');
    console.log(JSON.stringify(p, null, 2));
    console.log('═'.repeat(60));

    // === ĐỌC ĐÚNG TÊN TRƯỜNG DAHAHI ===
    const code = p.EmployeeCode || p.FacePersonId;
    const empName = p.EmployeeName || employeeNames[code] || `Mã: ${code}`;
    const checkTime = p.CheckinTime;
    const isCheckin = true; // DAHAHI gửi chỉ "vào ca" theo định dạng này

    console.log(`✅ Đọc được -> Mã: ${code} | Tên: ${empName} | Thời gian: ${checkTime}`);

    if (!code) {
      console.log('⚠️ KHÔNG TÌM THẤY MÃ NHÂN VIÊN!');
      return res.status(200).json({ ok: false, note: 'Thiếu mã nhân viên' });
    }

    // Gửi Discord
    const embed = buildEmbed(empName, checkTime, isCheckin);
    await sendDiscord(embed);

    res.json({ ok: true, employee: empName, time: checkTime });
  } catch (e) {
    console.error('❌ LỖI XỬ LÝ:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== TEST NHANH =====
app.get('/test', async (req, res) => {
  try {
    if (!DISCORD_WEBHOOK_URL) {
      return res.send('❌ THIẾU biến DISCORD_WEBHOOK_URL trên Render!');
    }
    const embed = buildEmbed('Dương Nhất Vy', '20/09/2026 18:51:52', true);
    await sendDiscord(embed);
    res.send('✅ Test thành công! Kiểm tra Discord ngay!');
  } catch (e) {
    res.status(500).send('❌ Lỗi: ' + e.message);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server chạy trên cổng ${PORT}`);
});
