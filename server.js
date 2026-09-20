const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '10mb' }));

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

console.log('🔑 Webhook URL:', DISCORD_WEBHOOK_URL ? '✅ Đã cấu hình' : '❌ THIẾU URL!');

// ===== LƯU TRẠNG THÁI MỖI NHÂN VIÊN =====
// true = lần cuối là Vào → lần tiếp theo là Ra
// false = lần cuối là Ra → lần tiếp theo là Vào
const lastStatus = {};

// ===== DANH SÁCH NHÂN VIÊN =====
const employeeNames = {
  'EMP00000003': 'Dương Nhất Vy',
  'EMP000149': 'Nguyễn Thị Huyền',
  // Thêm nhân viên khác...
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

    if (!code) {
      console.log('⚠️ KHÔNG TÌM THẤY MÃ NHÂN VIÊN!');
      return res.status(200).json({ ok: false, note: 'Thiếu mã nhân viên' });
    }

    // === TỰ XÁC ĐỊNH VÀO / RA THEO LẦN CHẤM ===
    // Chưa có bản ghi → mặc định Vào ca
    if (lastStatus[code] === undefined) {
      lastStatus[code] = true;
    }

    const isCheckin = lastStatus[code];
    const typeText = isCheckin ? '▶ VÀO CA' : '■ RA CA';

    console.log(`🔄 ${typeText} -> ${empName} | Lần tiếp theo: ${isCheckin ? 'Ra ca' : 'Vào ca'}`);

    // Đảo trạng thái cho lần tiếp theo
    lastStatus[code] = !lastStatus[code];

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

// ===== XEM TRẠNG THÁI TẤT CẢ =====
app.get('/status', (req, res) => {
  const result = {};
  for (const [code, status] of Object.entries(lastStatus)) {
    result[code] = status ? 'Lần cuối: Vào → Tiếp theo: Ra' : 'Lần cuối: Ra → Tiếp theo: Vào';
  }
  res.json({ message: 'Trạng thái luân phiên', data: result });
});

// ===== TEST NHANH =====
app.get('/test', async (req, res) => {
  try {
    if (!DISCORD_WEBHOOK_URL) {
      return res.send('❌ THIẾU biến DISCORD_WEBHOOK_URL!');
    }
    // Reset trạng thái để test
    lastStatus['EMP00000003'] = undefined;
    
    await sendDiscord(buildEmbed('Dương Nhất Vy', '20/09/2026 08:00:00', true));
    await sendDiscord(buildEmbed('Dương Nhất Vy', '20/09/2026 18:00:00', false));
    
    res.send('✅ Đã gửi 2 tin: Vào ca → Ra ca! Kiểm tra Discord!');
  } catch (e) {
    res.status(500).send('❌ Lỗi: ' + e.message);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server chạy trên cổng ${PORT}`);
  console.log(`🔗 Webhook: POST /webhook/dahahi`);
  console.log(`📊 Trạng thái: GET /status`);
});
