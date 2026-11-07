import type { BranchlogApi } from '@shared/types'

declare global {
  interface Window {
    branchlog: BranchlogApi
  }
}

export {}
