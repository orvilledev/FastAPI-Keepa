import { APP_ICON_URL, APP_NAME } from '../../constants/app'
import { useTheme } from '../../contexts/ThemeContext'

const APP_ICON_DOPAMINE_URL = `${import.meta.env.BASE_URL}app-icon-dopamine.svg`

type AppLogoProps = {
  className?: string
  alt?: string
}

/** App mark that switches to the pink Dopamine asset when that theme is active. */
export default function AppLogo({ className, alt = APP_NAME }: AppLogoProps) {
  const { theme } = useTheme()
  const src = theme === 'dopamine' ? APP_ICON_DOPAMINE_URL : APP_ICON_URL
  return <img src={src} alt={alt} className={className} />
}
