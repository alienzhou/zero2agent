// 用于调试演示的目标脚本
function add(a, b) {
  const result = a + b
  return result
}

function greet(name) {
  const msg = `Hello, ${name}!`
  return msg
}

function main() {
  const x = add(3, 7)
  const y = add(x, 5)
  const greeting = greet('Zero2Agent')
  console.log(`x=${x}, y=${y}, greeting=${greeting}`)
}

main()

// 保持进程存活，让调试器有时间连接
setTimeout(() => {
  console.log('target script finished')
  process.exit(0)
}, 60000)
