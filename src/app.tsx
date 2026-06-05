/**
 * @file Taro application entry file
 */

import type React from 'react'
import type {PropsWithChildren} from 'react'
import {useTabBarPageClass} from '@/hooks/useTabBarPageClass'

import './app.scss'
import {AuthProvider} from '@/contexts/AuthContext'

const App: React.FC = ({children}: PropsWithChildren<unknown>) => {
  useTabBarPageClass()

  return <AuthProvider>{children}</AuthProvider>}

export default App