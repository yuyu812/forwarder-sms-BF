/**
 * SMS 转发处理器
 */

import { validateTimestamp, extractCode } from '../utils/validator.js';
import { sendBarkNotification, buildNotificationContent } from '../utils/bark.js';
import { sendFeishuNotification } from '../utils/feishu.js';
import { sendWecomNotification } from '../utils/wecom.js';
import { sendDingtalkNotification } from '../utils/dingtalk.js';
import { sendWeixinNotification } from '../utils/weixin.js';
import { checkRateLimit } from '../utils/rateLimit.js';

/**
 * 处理 SMS 转发请求
 */
export async function handleSmsForward(request, env, url) {
    const isDebug = url.searchParams.get('debug') === 'true' || env.DEBUG === 'true';

    // 1. Token 鉴权（不易踩坑版）
    const auth = (request.headers.get('Authorization') || '').trim();
    const expected = `Bearer ${env.API_TOKEN}`;

    if (auth !== expected) {
        console.log('Auth failed');
        return jsonResponse({ success: false, message: 'Unauthorized' }, 401);
    }

    // 2. 解析请求体
    let body;
    try {
        body = await request.json();
    } catch (e) {
        return jsonResponse({ success: false, message: 'Invalid JSON' }, 400);
    }

    // 🔑 无条件转字符串（兼容 iOS / Webhook / curl）
    const content = String(body?.content ?? '').trim();

    // 🔑 再判断是否为空
    if (!content) {
        return jsonResponse({ success: false, message: 'Missing or invalid content field' }, 400);
    }

    if (content.length > 1000) {
        return jsonResponse({ success: false, message: 'Content too long' }, 400);
    }

    console.log('Received SMS forward request:', {
        device: body.device,
        contentLength: content.length,
        hasCode: !!body.code,
    });

    // 3. 时间戳校验
    const timestampResult = validateTimestamp(body.timestamp);
    if (!timestampResult.valid) {
        return jsonResponse({ success: false, message: timestampResult.error }, 400);
    }

    // 4. 速率限制
    const device = typeof body.device === 'string' ? body.device.trim() : '';
    const deviceId = device || 'unknown';
    const clientIp = (request.headers.get('CF-Connecting-IP')
        || request.headers.get('X-Forwarded-For')
        || '')
        .split(',')[0]
        .trim();
    const rateKey = deviceId !== 'unknown' ? `device:${deviceId}` : (clientIp ? `ip:${clientIp}` : 'unknown');
    const rateResult = await checkRateLimit(env, rateKey);
    if (!rateResult.allowed) {
        return jsonResponse({ success: false, message: rateResult.error }, 429);
    }

    // 5. 提取验证码
    let code = body.code;
    if (!code) {
        code = extractCode(content);
    }

    // 6. KV 去重检查（基于内容 + 设备 hash）
    const dedupeSource = deviceId !== 'unknown' ? `${deviceId}\n${content}` : content;
    const contentHash = await hashContent(dedupeSource);
    const dedupeKey = `sms:${contentHash}`;
    const existing = await env.SMS_CACHE.get(dedupeKey);

    if (existing) {
        console.log(`Duplicate SMS detected: ${contentHash.slice(0, 8)}...`);
        return jsonResponse({
            success: true,
            message: 'skipped',
            reason: 'duplicate',
            code,
        });
    }

    // 写入缓存，TTL 300秒
    await env.SMS_CACHE.put(dedupeKey, JSON.stringify({
        device: deviceId,
        timestamp: Date.now(),
        content: content.slice(0, 100), // 只存储前100字符
    }), { expirationTtl: 300 });

    // 8. Debug 模式：只写 KV，不推送
    if (isDebug) {
        console.log('Debug mode: skipping all pushes');
        return jsonResponse({
            success: true,
            message: 'debug',
            code,
            note: 'All pushes skipped in debug mode',
        });
    }

    // 8. 发送飞书 / 企业微信 / 钉钉 推送
    const title = code ? '📩 短信验证码' : '📩 新短信';

    const targetKeys = body.target && Array.isArray(body.target) ? body.target : null;
    const barkContent = buildNotificationContent(code, content, deviceId);
    const barkPromise = env.BARK_KEYS
        ? sendBarkNotification(env, barkContent.title, barkContent.body, targetKeys)
        : Promise.resolve({ success: false, pushed: 0 });

    const [feishuResult, wecomResult, dingtalkResult, barkResult, weixinResult] = await Promise.all([
        sendFeishuNotification(env, title, content, deviceId, code),
        sendWecomNotification(env, title, content, deviceId, code),
        sendDingtalkNotification(env, title, content, deviceId, code),
        barkPromise,
        sendWeixinNotification(env, title, content, deviceId, code),
    ]);

    // 判断推送结果
    if (!feishuResult.success && !wecomResult.success && !dingtalkResult.success && !barkResult.success && !weixinResult.success) {
        console.error('All push channels failed');
        return jsonResponse({
            success: false,
            message: 'Push failed',
            errors: {
                feishu: feishuResult.error,
                wecom: wecomResult.error,
                dingtalk: dingtalkResult.error,
                bark: barkResult.errors,
                weixin: weixinResult.error,
            },
        }, 502);
    }

    console.log(`SMS forwarded successfully: code=${code}, feishu=${feishuResult.success}, wecom=${wecomResult.success}, dingtalk=${dingtalkResult.success}, bark=${barkResult.pushed}, weixin=${weixinResult.success}`);

    return jsonResponse({
        success: true,
        message: 'forwarded',
        code,
        feishu: feishuResult.success,
        wecom: wecomResult.success,
        dingtalk: dingtalkResult.success,
        bark: barkResult.pushed,
        weixin: weixinResult.success,
    });
}

/**
 * JSON 响应辅助函数
 */
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
    });
}

/**
 * 计算内容 hash（用于去重）
 */
async function hashContent(content) {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
