$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object Windows.Forms.Form
$form.Text = 'AgentX M1：真实 Flash 首轮验收'
$form.ClientSize = New-Object Drawing.Size(580, 260)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$label = New-Object Windows.Forms.Label
$label.Location = New-Object Drawing.Point(20, 20)
$label.Size = New-Object Drawing.Size(540, 100)
$label.Text = "只调用 deepseek-v4-flash，最多发送一次任务。`n合成项目及引擎上下文将发送到 DeepSeek，产生实际用量。`n密钥由产品系统加密保存在本次隔离目录，不写进脚本或日志。`n如出现权限审批，请在随后打开的 AgentX 窗口检查。"
$box = New-Object Windows.Forms.TextBox
$box.Location = New-Object Drawing.Point(20, 125)
$box.Size = New-Object Drawing.Size(540, 28)
$box.UseSystemPasswordChar = $true
$box.MaxLength = 4096
$ok = New-Object Windows.Forms.Button
$ok.Text = '开始本次验收'
$ok.Location = New-Object Drawing.Point(310, 195)
$ok.Size = New-Object Drawing.Size(130, 35)
$ok.Enabled = $false
$ok.DialogResult = [Windows.Forms.DialogResult]::OK
$cancel = New-Object Windows.Forms.Button
$cancel.Text = '取消'
$cancel.Location = New-Object Drawing.Point(450, 195)
$cancel.Size = New-Object Drawing.Size(110, 35)
$cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
$box.Add_TextChanged({ $ok.Enabled = $box.Text.Trim().Length -gt 0 })
$form.Controls.AddRange(@($label, $box, $ok, $cancel))
$form.CancelButton = $cancel
try {
    if ($form.ShowDialog() -eq [Windows.Forms.DialogResult]::OK) {
        # stdout 仅由 Node 父进程匿名管道接收，不交给终端或日志。
        [Console]::Out.WriteLine((@{ apiKey = $box.Text.Trim() } | ConvertTo-Json -Compress))
    } else { [Console]::Out.WriteLine('{"cancelled":true}') }
} finally { $box.Clear(); $form.Dispose() }
