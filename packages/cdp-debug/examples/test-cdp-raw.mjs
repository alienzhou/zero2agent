// 直接测试 chrome-remote-interface 的 paused 事件
import CDP from 'chrome-remote-interface'

async function main() {
  console.log('Connecting to CDP on port 9234...')
  const client = await CDP({ port: 9234, host: '127.0.0.1' })
  console.log('Connected!')

  const { Debugger, Runtime } = client

  // 方法 1：domain.event(cb) 形式
  Debugger.paused((params) => {
    console.log(`[event] Debugger.paused! reason=${params.reason}, frames=${params.callFrames.length}`)
    console.log(`  top frame: ${params.callFrames[0]?.functionName || '(top)'} @ line ${params.callFrames[0]?.location?.lineNumber}`)
  })

  Debugger.resumed(() => {
    console.log('[event] Debugger.resumed!')
  })

  // 方法 2：client.on 形式
  client.on('event', (msg) => {
    if (msg.method?.startsWith('Debugger.')) {
      console.log(`[client.on event] ${msg.method}`)
    }
  })

  console.log('Calling Debugger.enable()...')
  await Debugger.enable()
  console.log('Debugger.enable() done')

  console.log('Calling Runtime.enable()...')
  await Runtime.enable()
  console.log('Runtime.enable() done')

  console.log('Waiting 2 seconds for paused event...')
  await new Promise(r => setTimeout(r, 2000))

  console.log('Done waiting. Closing.')
  await client.close()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
