import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId:'com.xiaolidawang.cijian',
  appName:'词间',
  webDir:'dist-android',
  backgroundColor:'#ffffff',
  server:{ hostname:'localhost', androidScheme:'https' },
  android:{ backgroundColor:'#ffffff', allowMixedContent:false },
  plugins:{ SystemBars:{ insetsHandling:'native', initialViewportFitValueHint:'cover', style:'LIGHT' } },
}
export default config
