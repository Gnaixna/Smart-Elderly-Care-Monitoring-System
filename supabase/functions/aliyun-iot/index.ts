/**
 * aliyun-iot
 * 阿里云物联网平台 API 代理函数
 *
 * 支持两种操作：
 *   action: 'getProperty'  → 查询设备当前属性快照
 *   action: 'setProperty'  → 下发属性设置到设备（修改阈值等）
 *
 * 阿里云 IoT API 签名算法：HMAC-SHA1
 * 参考文档：https://help.aliyun.com/document_detail/30561.html
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/** URL 编码（阿里云签名要求编码空格为 %20 而非 +） */
function rfc3986Encode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
}

/** 生成随机 Nonce */
function randomNonce(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

/** ISO 8601 时间戳 */
function isoTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** HMAC-SHA1 签名 */
async function hmacSha1Base64(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message))
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
}

/**
 * 调用阿里云 IoT API
 * @param action API Action 名称
 * @param params 业务参数（不含公共参数）
 */
async function callAliyunIotApi(
  action: string,
  params: Record<string, string>,
  accessKeyId: string,
  accessKeySecret: string,
  region: string,
  instanceId?: string
): Promise<unknown> {
  // 企业版专有实例必须传 IotInstanceId，否则报 "product does not exist"
  const instanceParam: Record<string, string> = instanceId ? { IotInstanceId: instanceId } : {}

  const commonParams: Record<string, string> = {
    Action: action,
    Format: 'JSON',
    Version: '2018-01-20',
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: isoTimestamp(),
    SignatureVersion: '1.0',
    SignatureNonce: randomNonce(),
    ...instanceParam,
    ...params,
  }

  // 按参数名字母排序
  const sortedKeys = Object.keys(commonParams).sort()
  const canonicalQueryString = sortedKeys
    .map((k) => `${rfc3986Encode(k)}=${rfc3986Encode(commonParams[k])}`)
    .join('&')

  // 构建待签名字符串
  const stringToSign = `GET&${rfc3986Encode('/')}&${rfc3986Encode(canonicalQueryString)}`

  // 计算签名
  const signature = await hmacSha1Base64(`${accessKeySecret}&`, stringToSign)

  // 构建最终 URL
  const finalParams = new URLSearchParams({
    ...commonParams,
    Signature: signature,
  })

  const endpoint = `https://iot.${region}.aliyuncs.com/?${finalParams.toString()}`

  const response = await fetch(endpoint, { method: 'GET' })
  const data = await response.json()

  if (!response.ok || data.Code) {
    throw new Error(data.ErrorMessage || data.Message || JSON.stringify(data))
  }

  return data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const accessKeyId = Deno.env.get('ALIYUN_ACCESS_KEY_ID')
    const accessKeySecret = Deno.env.get('ALIYUN_ACCESS_KEY_SECRET')
    const region = Deno.env.get('ALIYUN_IOT_REGION') || 'cn-shanghai'
    const instanceId = Deno.env.get('ALIYUN_IOT_INSTANCE_ID') // 企业版专有实例 ID，公共实例不需要

    if (!accessKeyId || !accessKeySecret) {
      return new Response(JSON.stringify({
        error: '阿里云 IoT 密钥未配置，请在小程序后台设置 ALIYUN_* 环境变量'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const { action, properties } = body

    // 优先使用请求体中传入的 productKey/deviceName（用于多设备场景）
    const productKey = body.productKey || Deno.env.get('ALIYUN_IOT_PRODUCT_KEY')
    const deviceName = body.deviceName || Deno.env.get('ALIYUN_IOT_DEVICE_NAME')

    if (!productKey || !deviceName) {
      // 软失败：设备未配置时不抛 4xx/5xx，前端可优雅降级
      return new Response(JSON.stringify({
        success: false,
        error: '设备未配置 ProductKey/DeviceName，请先在「我的」页面完成设备连接',
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let result: unknown

    if (action === 'getProperty') {
      // 查询设备当前所有属性快照
      result = await callAliyunIotApi(
        'QueryDevicePropertyStatus',
        { ProductKey: productKey, DeviceName: deviceName },
        accessKeyId, accessKeySecret, region, instanceId
      )
    } else if (action === 'setProperty') {
      // 下发属性到设备
      // properties 示例：{ HeartRateMax: 100, HeartRateMin: 50, ... }
      if (!properties || typeof properties !== 'object') {
        throw new Error('setProperty 需要传入 properties 对象')
      }
      result = await callAliyunIotApi(
        'SetDevicesProperty',
        {
          ProductKey: productKey,
          DeviceNames: JSON.stringify([deviceName]),
          Items: JSON.stringify(properties),
        },
        accessKeyId, accessKeySecret, region, instanceId
      )
    } else if (action === 'getDeviceInfo') {
      // 查询设备详情（含在线状态）
      // 企业版实例使用 QueryDeviceDetail，返回 Data.Status = ONLINE/OFFLINE
      result = await callAliyunIotApi(
        'QueryDeviceDetail',
        { ProductKey: productKey, DeviceName: deviceName },
        accessKeyId, accessKeySecret, region, instanceId
      )
    } else {
      throw new Error(`不支持的 action: ${action}`)
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('aliyun-iot error:', err)
    // 返回 200 + success:false，避免前端因 IoT 失败而中断正常业务流程
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
