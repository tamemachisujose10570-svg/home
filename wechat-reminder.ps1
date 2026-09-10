$webhookUrl = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=替换为你的KEY"
$message = "【每周提醒】大家好，本周六例行提醒：请查看群公告，按时完成任务。"
$mentioned = @()   # 如需@人，填写成员手机号，如 @("13800000000")，留空则不@

$body = @{
    msgtype = "text"
    text = @{
        content = $message
        mentioned_mobile_list = $mentioned
    }
} | ConvertTo-Json -Depth 3

$response = Invoke-RestMethod -Uri $webhookUrl -Method Post -Body $body -ContentType "application/json; charset=utf-8"

if ($response.errcode -eq 0) {
    Write-Output ("[OK] 发送成功: " + (Get-Date))
} else {
    Write-Output ("[FAIL] 发送失败: errcode=" + $response.errcode + " errmsg=" + $response.errmsg)
}
