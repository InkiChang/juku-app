import download from '../../icon/下载_download.svg?url';
import lightTheme from '../../icon/亮色模式.svg?url';
import about from '../../icon/关于.svg?url';
import refresh from '../../icon/刷新_refresh.svg?url';
import library from '../../icon/剧库.svg?url';
import mine from '../../icon/我的_people.svg?url';
import darkTheme from '../../icon/暗色模式.svg?url';
import server from '../../icon/服务器_server.svg?url';
import userManagement from '../../icon/用户管理.svg?url';
import history from '../../icon/观看记录.svg?url';
import settings from '../../icon/设置_setting-two.svg?url';
import accountSecurity from '../../icon/账号安全.svg?url';
import following from '../../icon/追剧.svg?url';
import home from '../../icon/首页_home-two.svg?url';

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
