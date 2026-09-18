import download from '../../icon/下载_download.svg?raw';
import lightTheme from '../../icon/亮色模式.svg?raw';
import about from '../../icon/关于.svg?raw';
import refresh from '../../icon/刷新_refresh.svg?raw';
import library from '../../icon/剧库.svg?raw';
import mine from '../../icon/我的_people.svg?raw';
import darkTheme from '../../icon/暗色模式.svg?raw';
import server from '../../icon/服务器_server.svg?raw';
import userManagement from '../../icon/用户管理.svg?raw';
import history from '../../icon/观看记录.svg?raw';
import settings from '../../icon/设置_setting-two.svg?raw';
import accountSecurity from '../../icon/账号安全.svg?raw';
import following from '../../icon/追剧.svg?raw';
import home from '../../icon/首页_home-two.svg?raw';

export const icons = {
  home,
  library,
  following,
  download,
  mine,
  lightTheme,
  darkTheme,
  refresh,
  server,
  userManagement,
  history,
  settings,
  accountSecurity,
  about,
} as const;

export type IconName = keyof typeof icons;
