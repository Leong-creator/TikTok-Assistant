param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Command,

  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$Arguments
)

& $Command @Arguments
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
