/**
 * ============================================
 * JLPT Premium Authentication System
 * ============================================
 * File này chứa logic kiểm tra phân quyền Standard/Premium
 * 
 * Cách dùng:
 * 1. Upload file này lên GitHub repo
 * 2. Import vào Blogspot: <script src="https://cdn.jsdelivr.net/gh/USERNAME/REPO/auth-premium.js"></script>
 * 3. Gọi các hàm: checkPremiumStatus(), checkAILimit(), checkVocabAccess(), checkVoiceGameAccess()
 * 
 * Lưu ý: File này KHÔNG chứa API key. API key vẫn ở trong từng file XML.
 */

// ============================================
// 1. KIỂM TRA TRẠNG THÁI PREMIUM
// ============================================
async function checkPremiumStatus() {
    try {
        // Lấy Supabase client từ window (đã init trong XML)
        if (!window.supabase || !window.supa) {
            console.error('Supabase chưa được khởi tạo!');
            return { isPremium: false, reason: 'supabase_not_init' };
        }

        const supaClient = window.supa || window.supabase;

        // Lấy user hiện tại
        const { data: { user }, error: authError } = await supaClient.auth.getUser();

        if (authError || !user) {
            return { isPremium: false, reason: 'not_logged_in' };
        }

        // Lấy profile từ database
        const { data: profile, error: profileError } = await supaClient
            .from('profiles')
            .select('subscription_type, premium_until')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            console.error('Lỗi lấy profile:', profileError);
            return { isPremium: false, reason: 'no_profile' };
        }

        // Kiểm tra Premium có hết hạn không
        if (profile.subscription_type === 'premium') {
            const now = new Date();
            const expiry = new Date(profile.premium_until);

            if (now > expiry) {
                // Hết hạn → Tự động chuyển về Standard
                await supaClient.from('profiles')
                    .update({ subscription_type: 'standard' })
                    .eq('id', user.id);

                return {
                    isPremium: false,
                    reason: 'expired',
                    expiredDate: expiry
                };
            }

            // Còn hạn Premium
            const daysRemaining = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
            return {
                isPremium: true,
                expiryDate: expiry,
                daysRemaining: daysRemaining
            };
        }

        // Standard user
        return { isPremium: false, reason: 'standard' };

    } catch (error) {
        console.error('Lỗi checkPremiumStatus:', error);
        return { isPremium: false, reason: 'error', error: error.message };
    }
}

// ============================================
// 2. KIỂM TRA GIỚI HẠN AI SENSEI (3 lượt/ngày)
// ============================================
async function checkAILimit() {
    try {
        const supaClient = window.supa || window.supabase;

        const { data: { user } } = await supaClient.auth.getUser();
        if (!user) {
            return { allowed: false, reason: 'not_logged_in' };
        }

        // Lấy thông tin giới hạn AI
        const { data: profile, error } = await supaClient
            .from('profiles')
            .select('subscription_type, daily_ai_count, last_reset_date')
            .eq('id', user.id)
            .single();

        if (error || !profile) {
            console.error('Lỗi lấy AI limit:', error);
            return { allowed: false, reason: 'no_profile' };
        }

        // Premium → Không giới hạn
        if (profile.subscription_type === 'premium') {
            return {
                allowed: true,
                isPremium: true,
                remaining: '∞',
                message: 'Premium - Không giới hạn'
            };
        }

        // Reset counter nếu qua ngày mới
        const today = new Date().toISOString().split('T')[0];
        if (profile.last_reset_date !== today) {
            await supaClient.from('profiles').update({
                daily_ai_count: 0,
                last_reset_date: today
            }).eq('id', user.id);

            return {
                allowed: true,
                remaining: 3,
                current: 0,
                max: 3,
                wasReset: true
            };
        }

        // Kiểm tra đã hết lượt chưa
        const currentCount = profile.daily_ai_count || 0;

        if (currentCount >= 3) {
            return {
                allowed: false,
                reason: 'ai_limit',
                remaining: 0,
                current: 3,
                max: 3,
                message: '🤖 Bạn đã hết 3 lượt hỏi AI hôm nay! Nâng cấp Premium để không giới hạn.'
            };
        }

        // Còn lượt → Tăng counter
        await supaClient.from('profiles')
            .update({ daily_ai_count: currentCount + 1 })
            .eq('id', user.id);

        return {
            allowed: true,
            remaining: 2 - currentCount,
            current: currentCount + 1,
            max: 3,
            message: `Còn ${2 - currentCount} lượt hỏi AI hôm nay`
        };

    } catch (error) {
        console.error('Lỗi checkAILimit:', error);
        return { allowed: false, reason: 'error', error: error.message };
    }
}

// ============================================
// 3. KIỂM TRA QUYỀN HỌC TỪ VỰNG (N2/N1 chỉ Premium)
// ============================================
async function checkVocabAccess(level) {
    try {
        const supaClient = window.supa || window.supabase;

        const { data: { user } } = await supaClient.auth.getUser();
        if (!user) {
            return { allowed: false, reason: 'not_logged_in' };
        }

        // N5, N4, N3 → Ai cũng học được
        if (['N5', 'N4', 'N3'].includes(level)) {
            return { allowed: true, level: level };
        }

        // N2, N1 → Kiểm tra Premium
        if (['N2', 'N1'].includes(level)) {
            const { data: profile } = await supaClient
                .from('profiles')
                .select('subscription_type')
                .eq('id', user.id)
                .single();

            if (!profile) {
                return { allowed: false, reason: 'no_profile' };
            }

            if (profile.subscription_type === 'premium') {
                return { allowed: true, level: level };
            }

            return {
                allowed: false,
                reason: 'premium_required',
                level: level,
                message: `📚 Từ vựng ${level} chỉ dành cho Premium! Nâng cấp ngay để học toàn bộ N1-N5.`
            };
        }

        // Level không hợp lệ
        return { allowed: true };

    } catch (error) {
        console.error('Lỗi checkVocabAccess:', error);
        return { allowed: false, reason: 'error', error: error.message };
    }
}

// ============================================
// 4. KIỂM TRA QUYỀN CHƠI GAME VOICE (Chỉ Premium)
// ============================================
async function checkVoiceGameAccess() {
    try {
        const supaClient = window.supa || window.supabase;

        const { data: { user } } = await supaClient.auth.getUser();
        if (!user) {
            return { allowed: false, reason: 'not_logged_in' };
        }

        const { data: profile } = await supaClient
            .from('profiles')
            .select('subscription_type')
            .eq('id', user.id)
            .single();

        if (!profile) {
            return { allowed: false, reason: 'no_profile' };
        }

        if (profile.subscription_type === 'premium') {
            return { allowed: true };
        }

        return {
            allowed: false,
            reason: 'premium_required',
            message: '🎤 Chế độ Voice (Nói) chỉ dành cho Premium! Nâng cấp để mở khóa.'
        };

    } catch (error) {
        console.error('Lỗi checkVoiceGameAccess:', error);
        return { allowed: false, reason: 'error', error: error.message };
    }
}

// ============================================
// 5. HIỂN THỊ MODAL NÂNG CẤP
// ============================================
function showUpgradeModal(reason = 'general', data = {}) {
    // Kiểm tra modal đã tồn tại chưa
    let modal = document.getElementById('upgrade-modal');

    if (!modal) {
        // Tạo modal mới nếu chưa có
        modal = createUpgradeModal();
    }

    // Tùy chỉnh message theo lý do
    const messages = {
        'ai_limit': '⏰ Bạn đã hết 3 lượt hỏi AI Sensei hôm nay!',
        'lookup': '🔍 Tính năng Tra từ chỉ dành cho Premium!',
        'vocab_locked': `🔒 Từ vựng ${data.level || 'N2/N1'} chỉ dành cho Premium!`,
        'voice_game': '🎤 Chế độ Voice (Nói) chỉ dành cho Premium!',
        'general': '⭐ Nâng cấp Premium để mở khóa toàn bộ tính năng!'
    };

    const messageEl = document.getElementById('upgrade-message');
    if (messageEl) {
        messageEl.textContent = messages[reason] || messages.general;
    }

    modal.style.display = 'flex';
}

function closeUpgradeModal() {
    const modal = document.getElementById('upgrade-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// ============================================
// 6. TẠO MODAL NÂNG CẤP (HTML/CSS)
// ============================================
function createUpgradeModal() {
    const modalHTML = `
    <div id="upgrade-modal" class="upgrade-modal-overlay" style="display:none;">
      <div class="upgrade-modal-box">
        <div class="upgrade-close" onclick="closeUpgradeModal()">×</div>
        
        <div class="upgrade-icon">⭐</div>
        <h2 class="upgrade-title">Nâng cấp lên Premium</h2>
        <p id="upgrade-message" class="upgrade-message">Mở khóa toàn bộ tính năng!</p>
        
        <div class="pricing-cards">
          <div class="price-card">
            <h3>1 Tháng</h3>
            <div class="price">99.000đ</div>
            <button class="select-plan-btn" onclick="selectPlan('1_month', 99000)">Chọn</button>
          </div>
          
          <div class="price-card popular">
            <div class="popular-badge">Phổ biến nhất</div>
            <h3>3 Tháng</h3>
            <div class="price">249.000đ</div>
            <div class="save-tag">Tiết kiệm 20%</div>
            <button class="select-plan-btn" onclick="selectPlan('3_months', 249000)">Chọn</button>
          </div>
          
          <div class="price-card">
            <h3>1 Năm</h3>
            <div class="price">799.000đ</div>
            <div class="save-tag">Tiết kiệm 33%</div>
            <button class="select-plan-btn" onclick="selectPlan('1_year', 799000)">Chọn</button>
          </div>
        </div>
        
        <div class="features-list">
          <div class="feature-item">✅ AI Sensei không giới hạn</div>
          <div class="feature-item">✅ AI Tra từ thông minh</div>
          <div class="feature-item">✅ Toàn bộ từ vựng N1-N5</div>
          <div class="feature-item">✅ Game Voice (Nói)</div>
          <div class="feature-item">✅ Lưu lịch sử vĩnh viễn</div>
        </div>
      </div>
    </div>
    
    <style>
      .upgrade-modal-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.7); z-index: 99999;
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(5px);
      }
      .upgrade-modal-box {
        background: white; width: 95%; max-width: 900px;
        border-radius: 24px; padding: 40px 30px;
        position: relative; max-height: 90vh; overflow-y: auto;
      }
      .upgrade-close {
        position: absolute; top: 20px; right: 25px;
        font-size: 32px; cursor: pointer; color: #999;
        width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;
        border-radius: 50%; transition: 0.2s;
      }
      .upgrade-close:hover { background: #f3f4f6; color: #333; }
      .upgrade-icon { font-size: 60px; text-align: center; margin-bottom: 10px; }
      .upgrade-title { text-align: center; font-size: 28px; font-weight: 800; color: #1f2937; margin: 0 0 10px 0; }
      .upgrade-message { text-align: center; color: #6b7280; font-size: 16px; margin-bottom: 30px; }
      
      .pricing-cards {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 20px; margin-bottom: 30px;
      }
      .price-card {
        background: #f9fafb; border: 2px solid #e5e7eb; border-radius: 16px;
        padding: 30px 20px; text-align: center; position: relative;
        transition: 0.3s;
      }
      .price-card:hover { transform: translateY(-5px); box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
      .price-card.popular { border-color: #10b981; background: #ecfdf5; }
      .popular-badge {
        position: absolute; top: -12px; left: 50%; transform: translateX(-50%);
        background: #10b981; color: white; padding: 4px 12px;
        border-radius: 20px; font-size: 12px; font-weight: 700;
      }
      .price-card h3 { font-size: 20px; margin: 0 0 15px 0; color: #374151; }
      .price { font-size: 32px; font-weight: 900; color: #1f2937; margin-bottom: 10px; }
      .save-tag { color: #10b981; font-weight: 700; font-size: 14px; margin-bottom: 15px; }
      .select-plan-btn {
        width: 100%; padding: 12px; background: linear-gradient(135deg, #10b981, #059669);
        color: white; border: none; border-radius: 12px; font-weight: 700;
        font-size: 16px; cursor: pointer; transition: 0.2s;
      }
      .select-plan-btn:hover { transform: scale(1.05); }
      
      .features-list {
        background: #f0fdf4; border: 2px solid #86efac; border-radius: 16px;
        padding: 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 10px;
      }
      .feature-item { font-size: 14px; color: #065f46; font-weight: 600; }
      
      @media (max-width: 768px) {
        .upgrade-modal-box { padding: 30px 20px; }
        .pricing-cards { grid-template-columns: 1fr; }
        .features-list { grid-template-columns: 1fr; }
      }
    </style>
  `;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = modalHTML;
    document.body.appendChild(tempDiv.firstElementChild);

    return document.getElementById('upgrade-modal');
}

// ============================================
// 7. XỬ LÝ CHỌN GÓI (Placeholder - Cần tích hợp Payment)
// ============================================
function selectPlan(plan, amount) {
    alert(`Bạn đã chọn gói ${plan} - ${amount.toLocaleString('vi-VN')}đ\n\nTính năng thanh toán đang được phát triển!`);

    // TODO: Tích hợp MoMo/VNPay ở đây
    // const paymentUrl = await createPayment(plan, amount);
    // window.location.href = paymentUrl;
}

// ============================================
// 8. HIỂN THỊ BADGE PREMIUM/STANDARD
// ============================================
async function renderUserBadge(containerId = 'user-badge') {
    const status = await checkPremiumStatus();
    const container = document.getElementById(containerId);

    if (!container) return;

    if (status.isPremium) {
        container.innerHTML = `
      <div style="background: linear-gradient(135deg, #FFD700, #FFA500); color: white; padding: 6px 15px; border-radius: 20px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; font-size: 14px;">
        <i class="fa-solid fa-crown"></i>
        Premium (${status.daysRemaining} ngày)
      </div>
    `;
    } else {
        container.innerHTML = `
      <div style="background: #e5e7eb; color: #6b7280; padding: 6px 15px; border-radius: 20px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; font-size: 14px;">
        <i class="fa-solid fa-user"></i>
        Standard
        <button onclick="showUpgradeModal()" style="margin-left: 8px; background: #10b981; color: white; border: none; padding: 4px 10px; border-radius: 10px; cursor: pointer; font-size: 12px; font-weight: 700;">
          Nâng cấp
        </button>
      </div>
    `;
    }
}

// ============================================
// 9. HIỂN THỊ LỚP PHỦ KHÓA NỘI DUNG
// ============================================
/**
 * Hiển thị lớp phủ mờ khóa nội dung
 * @param {string} containerId - ID của container cần phủ overlay
 * @param {string} reason - 'not_logged_in' | 'premium_required'
 * @param {object} options - Tùy chọn (loginUrl, upgradeUrl)
 */
function showLockedOverlay(containerId, reason = 'not_logged_in', options = {}) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error('Container không tồn tại:', containerId);
        return;
    }

    // Đảm bảo container có position relative
    container.style.position = 'relative';

    // Xóa overlay cũ nếu có
    const oldOverlay = container.querySelector('.locked-overlay');
    if (oldOverlay) oldOverlay.remove();

    // Nội dung theo lý do
    const content = {
        'not_logged_in': {
            icon: '🔐',
            title: 'Nội dung dành riêng cho thành viên',
            message: 'Vui lòng đăng nhập để sử dụng tính năng này!',
            btnText: 'Đăng nhập ngay',
            btnAction: options.loginUrl || '/p/dang-nhap.html',
            btnClass: 'lo-btn-login'
        },
        'premium_required': {
            icon: '⭐',
            title: 'Nội dung dành riêng cho Premium',
            message: 'Bạn vui lòng nâng cấp Premium để sử dụng tính năng này.',
            btnText: 'Nâng cấp Premium',
            btnAction: 'showUpgradeModal()',
            btnClass: 'lo-btn-premium'
        }
    };

    const info = content[reason] || content.not_logged_in;
    const isLink = !info.btnAction.includes('(');

    // Tạo overlay HTML
    const overlay = document.createElement('div');
    overlay.className = 'locked-overlay';
    overlay.innerHTML = `
        <style>
            .locked-overlay {
                position: absolute;
                top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(255, 255, 255, 0.95);
                backdrop-filter: blur(5px);
                display: flex; flex-direction: column;
                align-items: center; justify-content: center;
                z-index: 1000;
                border-radius: inherit;
                padding: 30px;
                box-sizing: border-box;
                text-align: center;
            }
            .lo-icon { font-size: 60px; margin-bottom: 20px; }
            .lo-title { 
                font-size: 20px; font-weight: 800; 
                color: #1f2937; margin: 0 0 10px 0;
            }
            .lo-message { 
                font-size: 15px; color: #6b7280; 
                line-height: 1.6; margin-bottom: 25px;
                max-width: 400px;
            }
            .lo-btn {
                padding: 12px 30px; border: none; border-radius: 10px;
                font-size: 16px; font-weight: 700; cursor: pointer;
                transition: 0.2s; text-decoration: none;
                display: inline-block;
            }
            .lo-btn-login {
                background: linear-gradient(135deg, #3b82f6, #2563eb);
                color: white;
                box-shadow: 0 4px 15px rgba(59, 130, 246, 0.3);
            }
            .lo-btn-login:hover { 
                transform: translateY(-2px); 
                box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4); 
            }
            .lo-btn-premium {
                background: linear-gradient(135deg, #f59e0b, #d97706);
                color: white;
                box-shadow: 0 4px 15px rgba(245, 158, 11, 0.3);
            }
            .lo-btn-premium:hover { 
                transform: translateY(-2px); 
                box-shadow: 0 6px 20px rgba(245, 158, 11, 0.4); 
            }
        </style>
        <div class="lo-icon">${info.icon}</div>
        <h3 class="lo-title">${info.title}</h3>
        <p class="lo-message">${info.message}</p>
        ${isLink
            ? `<a href="${info.btnAction}" class="lo-btn ${info.btnClass}">${info.btnText}</a>`
            : `<button class="lo-btn ${info.btnClass}" onclick="${info.btnAction}">${info.btnText}</button>`
        }
    `;

    container.appendChild(overlay);
}

/**
 * Xóa lớp phủ khóa
 * @param {string} containerId - ID của container
 */
function removeLockedOverlay(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const overlay = container.querySelector('.locked-overlay');
    if (overlay) overlay.remove();
}

/**
 * Kiểm tra và hiển thị overlay tự động
 * @param {string} containerId - ID container cần kiểm tra
 * @param {string} feature - 'ai' | 'vocab' | 'voice' | 'lookup'
 * @param {object} data - Dữ liệu bổ sung (level, etc.)
 */
async function checkAndShowOverlay(containerId, feature = 'general', data = {}) {
    const supaClient = window.supa || window.supabase;

    if (!supaClient) {
        console.error('Supabase chưa khởi tạo');
        return { locked: true, reason: 'error' };
    }

    // Kiểm tra đăng nhập
    const { data: { user } } = await supaClient.auth.getUser();

    if (!user) {
        showLockedOverlay(containerId, 'not_logged_in', data);
        return { locked: true, reason: 'not_logged_in' };
    }

    // Đã đăng nhập → Kiểm tra Premium cho các feature cần
    if (['vocab_n2', 'vocab_n1', 'voice', 'lookup'].includes(feature)) {
        const { data: profile } = await supaClient
            .from('profiles')
            .select('subscription_type')
            .eq('id', user.id)
            .single();

        if (!profile || profile.subscription_type !== 'premium') {
            showLockedOverlay(containerId, 'premium_required', data);
            return { locked: true, reason: 'premium_required' };
        }
    }

    // Không bị khóa
    return { locked: false };
}

// ============================================
// EXPORT (Để có thể dùng ở mọi nơi)
// ============================================
console.log('✅ Auth Premium System loaded successfully!');
