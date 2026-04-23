import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type AppOptions = {
  devMode: boolean
  setDevMode: (v: boolean) => void
}

export const useAppOptionsStore = create<AppOptions>()(
  persist(
    (set) => ({
      devMode: false,
      setDevMode: (v) => set({ devMode: v }),
    }),
    { name: 'travelmode-app-options' },
  ),
)
