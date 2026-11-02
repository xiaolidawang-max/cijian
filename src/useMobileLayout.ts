import { useEffect, useState } from 'react'

export function useMobileLayout() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width:900px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(max-width:900px)')
    const update = () => setMobile(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return mobile
}
