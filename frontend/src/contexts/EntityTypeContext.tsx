import { createContext, useContext, useEffect, useState } from 'react'
import { fetchEntities } from '../api'

// Maps lowercased entity name → entity type string
type EntityTypeMap = Map<string, string>

const EntityTypeContext = createContext<EntityTypeMap>(new Map())

export function EntityTypeProvider({ children }: { children: React.ReactNode }) {
  const [typeMap, setTypeMap] = useState<EntityTypeMap>(new Map())

  useEffect(() => {
    fetchEntities().then(entities => {
      const map = new Map<string, string>()
      for (const e of entities) {
        map.set(e.name.toLowerCase(), e.type)
      }
      setTypeMap(map)
    })
  }, [])

  return (
    <EntityTypeContext.Provider value={typeMap}>
      {children}
    </EntityTypeContext.Provider>
  )
}

export function useEntityTypes(): EntityTypeMap {
  return useContext(EntityTypeContext)
}
