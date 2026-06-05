export default defineAppConfig({
  pages: [
    'pages/login/index',
    'pages/monitor/index',
    'pages/history/index',
    'pages/profile/index',
    'pages/device/index',
    'pages/notification/index',
    'pages/alarm-detail/index',
  ],
  tabBar: {
    color: '#64748B',
    selectedColor: '#0D9488',
    backgroundColor: '#FFFFFF',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/monitor/index',
        text: '实时监测',
        iconPath: './assets/icons/monitor_unselected.png',
        selectedIconPath: './assets/icons/monitor_selected.png',
      },
      {
        pagePath: 'pages/history/index',
        text: '历史记录',
        iconPath: './assets/icons/history_unselected.png',
        selectedIconPath: './assets/icons/history_selected.png',
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        iconPath: './assets/icons/profile_unselected.png',
        selectedIconPath: './assets/icons/profile_selected.png',
      },
    ],
  },
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#0D9488',
    navigationBarTitleText: '智慧养老监护',
    navigationBarTextStyle: 'white',
  },
})
