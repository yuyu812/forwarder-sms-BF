/**
 * 微信 ilinkai Bot 推送工具
 * 通过 ilinkai 接口发送消息到个人微信
 */

/**
 * 发送微信 ilinkai 通知
 * @param {Object} env - Worker 环境变量
 * @param {string} title - 标题
 * @param {string} content - 短信内容
 * @param {string} device - 来源设备
 * @param {string} code - 验证码（可选）
 * @returns {Promise<Object>} 推送结果
 */
export async function sendWeixinNotification(env, title, content, device, code = null) {
    const botToken = env.WEIXIN_BOT_TOKEN;
    const targetUser = env.WEIXIN_TARGET_USER;

    if (!botToken || !targetUser) {
        console.warn('No WeChat ilinkai bot configured');
        return { success: false, error: 'No WeChat ilinkai bot configured' };
    }

    try {
        const text = buildWeixinText(title, content, device, code);

        const uin = btoa(String(Math.floor(Math.random() * 4294967296)));

        const payload = {
            msg: {
                to_user_id: targetUser,
                message_type: 2,
                message_state: 2,
                item_list: [
                    {
                        type: 1,
                        text_item: { text },
                    },
                ],
            },
        };

        const baseUrl = env.WEIXIN_BASE_URL || 'https://ilinkai.weixin.qq.com';

        const response = await fetch(`${baseUrl}/ilink/bot/sendmessage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'AuthorizationType': 'ilink_bot_token',
                'X-WECHAT-UIN': uin,
                'Authorization': `Bearer ${botToken}`,
            },
            body: JSON.stringify(payload),
        });

        if (response.ok) {
            console.log('WeChat ilinkai push success');
            return { success: true };
        }

        const result = await safeJson(response);
        const errorMsg = result.errmsg || result.msg || `HTTP ${response.status}`;
        console.error(`WeChat ilinkai push failed: ${errorMsg}`);
        return { success: false, error: errorMsg };
    } catch (error) {
        console.error(`WeChat ilinkai push error: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * 构建微信纯文本消息
 * @param {string} title - 标题
 * @param {string} content - 短信内容
 * @param {string} device - 来源设备
 * @param {string} code - 验证码（可选）
 * @returns {string} 消息文本
 */
function buildWeixinText(title, content, device, code) {
    const lines = [title];

    if (code) {
        lines.push(`验证码: ${code}`);
    }

    lines.push('');
    lines.push(content);

    if (device && device !== 'unknown') {
        lines.push('');
        lines.push(`来自: ${device}`);
    }

    lines.push(`时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);

    return lines.join('\n');
}

async function safeJson(response) {
    try {
        return await response.json();
    } catch {
        return {};
    }
}
