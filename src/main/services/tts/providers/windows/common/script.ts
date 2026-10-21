import { Buffer } from "node:buffer";

// PowerShell host driven over stdin/stdout, one JSON object per line.
// Request:  { id, type: "voices" } | { id, type: "speak", text, voice?, engine?, rate, volume }
// Response: { id, ok, data?, error? }
// NOTE: The script lives in a template literal, so it must not contain backticks.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
# The synthesizer is reused, so remember the system default before any SelectVoice.
$defaultVoice = $synth.Voice.Name

# OneCore (WinRT) voices are optional, SAPI keeps working if WinRT is unavailable.
$oneCore = $null
$asTask = $null
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'
  } | Select-Object -First 1
  $oneCore = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
} catch {
  $oneCore = $null
}

function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(-1)
  $task.Result
}

$stdin = [Console]::In
$stdout = [Console]::Out

while ($null -ne ($line = $stdin.ReadLine())) {
  if ($line.Trim() -eq '') { continue }
  $id = $null
  $data = $null
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    switch ($req.type) {
      'voices' {
        $data = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {
          $info = $_.VoiceInfo
          @{
            name   = $info.Name
            lang   = $info.Culture.Name
            engine = 'sapi'
          }
        })
        if ($oneCore) {
          # Legacy Microsoft voices are registered for both engines, "X Desktop" (SAPI) and "X" (OneCore). Keep the SAPI one.
          $sapiKeys = @{}
          foreach ($v in $data) { $sapiKeys["$($v.name)|$($v.lang)"] = $true }
          $data += @([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object {
            -not $sapiKeys.ContainsKey("$($_.DisplayName) Desktop|$($_.Language)")
          } | ForEach-Object {
            @{
              name   = $_.DisplayName
              lang   = $_.Language
              engine = 'onecore'
            }
          })
        }
      }
      'speak' {
        $ms = New-Object System.IO.MemoryStream
        try {
          if ($req.engine -eq 'onecore') {
            if (-not $oneCore) { throw 'OneCore voices are not available' }
            $voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -eq [string]$req.voice } | Select-Object -First 1
            if (-not $voice) { throw "OneCore voice not found: $($req.voice)" }
            $oneCore.Voice = $voice
            $oneCore.Options.SpeakingRate = [Math]::Max(0.5, [Math]::Min(6.0, 1 + [int]$req.rate / 10))
            $oneCore.Options.AudioVolume = [Math]::Max(0, [Math]::Min(1, [int]$req.volume / 100))
            $stream = Await ($oneCore.SynthesizeTextToStreamAsync([string]$req.text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
            try {
              [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream).CopyTo($ms)
            } finally {
              $stream.Dispose()
            }
          } else {
            if ($req.voice) { $synth.SelectVoice([string]$req.voice) } else { $synth.SelectVoice($defaultVoice) }
            $synth.Rate = [int]$req.rate
            $synth.Volume = [int]$req.volume
            $synth.SetOutputToWaveStream($ms)
            $synth.Speak([string]$req.text)
            $synth.SetOutputToNull()
          }
          $data = [Convert]::ToBase64String($ms.ToArray())
        } finally {
          $ms.Dispose()
        }
      }
      default { throw "Unknown request type: $($req.type)" }
    }
    $res = @{ id = $id; ok = $true; data = $data }
  } catch {
    $res = @{ id = $id; ok = $false; error = $_.Exception.Message }
  }
  $stdout.WriteLine((ConvertTo-Json -InputObject $res -Compress -Depth 4))
  $stdout.Flush()
}
`;

export const ENCODED_SCRIPT = Buffer.from(SCRIPT, "utf16le").toString("base64");
