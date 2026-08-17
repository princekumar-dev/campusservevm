import { useState, useEffect, useRef, useMemo } from 'react'
import apiClient from '../utils/apiClient'
import { Landmark, TrendingUp, ShieldCheck, Users, BarChart3, Filter, Building2, LoaderCircle } from 'lucide-react'
import { PageHeader } from '../components/ui'
import { ErrorState, LoadingState } from '../components/EmptyStates'
import { INSTITUTIONS } from '../constants/institutions'

const formatCurrency = value => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2
}).format(Number.isFinite(Number(value)) ? Number(value) : 0)

const formatCount = value => new Intl.NumberFormat('en-IN').format(Number.isFinite(Number(value)) ? Number(value) : 0)

const institutions = [
  { id: '', name: 'ALL INSTITUTIONS' },
  ...INSTITUTIONS.slice(0, 2).map(inst => ({ ...inst, name: inst.name.toUpperCase() })),
  { id: 'mcw', name: 'MCW', logo: '/images/MCW logo.jpg' },
  ...INSTITUTIONS.slice(2).map(inst => ({ ...inst, name: inst.name.toUpperCase() }))
]

function PreloadedImage({ src, alt, className }) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!src) return
    const img = new Image()
    img.onload = () => setLoaded(true)
    img.onerror = () => setError(true)
    img.src = src
  }, [src])

  if (error || !src) return <Building2 size={18} className="text-violet-600" />
  if (!loaded) return <LoaderCircle size={18} className="animate-spin text-slate-400" />
  return <img src={src} alt={alt || ''} className={className} />
}

function Reports() {
  const [stats, setStats] = useState({ totalRequests: 0, totalExpenses: 0, totalQuotations: 0, closed: 0 })
  const [categoryData, setCategoryData] = useState([])
  const [departmentData, setDepartmentData] = useState([])
  const [technicianData, setTechnicianData] = useState([])
  const [institutionFilter, setInstitutionFilter] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const requestVersion = useRef(0)

  const hasData = stats.totalRequests > 0 || categoryData.length > 0 || departmentData.length > 0

  const fetchReportData = async (institution = institutionFilter) => {
    const version = ++requestVersion.current
    if (hasData) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    setLoadError('')
    try {
      const qs = institution ? `?institution=${institution}` : ''
      const res = await apiClient.get(`/api/reports${qs}`, { cache: false })
      if (!res.success) throw new Error(res.error || 'Reports could not be loaded.')
      if (version !== requestVersion.current) return
      if (res.stats) {
        setStats(current => ({ ...current, ...res.stats }))
        if (res.charts) {
          setCategoryData(res.charts.categoryData || [])
          setDepartmentData(res.charts.departmentData || [])
          setTechnicianData(res.charts.technicianData || [])
        }
      }
    } catch (err) {
      if (version === requestVersion.current) setLoadError(err.message || 'Failed to retrieve reports data')
    } finally {
      if (version === requestVersion.current) {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    }
  }

  useEffect(() => { fetchReportData(institutionFilter) }, [institutionFilter])

  if (isLoading && !hasData) {
    return <LoadingState label="Loading financial and operational reports..." />
  }
  if (loadError && !hasData) return <ErrorState message={loadError} onRetry={() => fetchReportData(institutionFilter)} />

  const maxCategoryVal = categoryData.length > 0 ? Math.max(...categoryData.map(c => c.value)) : 1
  const maxDeptCost = departmentData.length > 0 ? Math.max(...departmentData.map(d => d.cost)) : 1

  return (
    <div className="space-y-8 page-enter text-left">
      <PageHeader
        title="Reports & Analytics"
        subtitle="Institutional overview of spending, purchases, and operations"
      />

      {/* Institution Filter */}
      <div className="premium-card relative overflow-hidden p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-slate-600">
            <Filter size={16} />
            <span className="text-xs font-bold uppercase tracking-wider">Institution filter</span>
          </div>
          {isLoading && <span className="flex items-center gap-1.5 text-xs font-bold text-violet-600" role="status"><LoaderCircle size={15} className="animate-spin" /> Updating report</span>}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {institutions.map(inst => (
            <button
              key={inst.id}
              onClick={() => setInstitutionFilter(inst.id)}
              aria-pressed={institutionFilter === inst.id}
              className={`flex min-h-[72px] items-center gap-3 rounded-2xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                institutionFilter === inst.id
                  ? 'border-violet-400 bg-violet-50 shadow-md shadow-violet-600/15'
                  : 'border-slate-200 bg-white hover:border-violet-200 hover:bg-slate-50'
              }`}
            >
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${institutionFilter === inst.id ? 'border-violet-200 bg-white' : 'border-slate-100 bg-slate-50'}`}>
                {inst.id ? <img src={inst.logo} alt="" className="h-7 w-7 object-contain" /> : <Building2 size={18} className="text-violet-600" />}
              </span>
              <span className={`text-xs font-black leading-tight ${institutionFilter === inst.id ? 'text-violet-700' : 'text-slate-700'}`}>{inst.name}</span>
            </button>
          ))}
        </div>
        {isLoading && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-violet-100"><div className="h-full w-1/3 animate-pulse rounded-full bg-violet-600" /></div>}
      </div>

      {loadError && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800" role="alert">Couldn’t refresh this institution’s report. <button onClick={() => fetchReportData(institutionFilter)} className="ml-1 font-black underline">Try again</button></div>}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="premium-card p-5 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Expenditure</span>
            <span className="text-xl font-black text-slate-800 mt-1 block">{formatCurrency(stats.totalExpenses)}</span>
            <span className="text-[10px] text-slate-500 mt-0.5 block">Cleared payments</span>
          </div>
          <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600">
            <Landmark size={20} />
          </div>
        </div>

        <div className="premium-card p-5 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Approved Budget</span>
            <span className="text-xl font-black text-slate-800 mt-1 block">{formatCurrency(stats.totalPOValue ?? stats.totalQuotations)}</span>
            <span className="text-[10px] text-slate-500 mt-0.5 block">Committed PO value</span>
          </div>
          <div className="p-3 bg-violet-50 rounded-xl text-violet-600">
            <TrendingUp size={20} />
          </div>
        </div>

        <div className="premium-card p-5 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Resolution Rate</span>
            <span className="text-xl font-black text-slate-800 mt-1 block">
              {stats.totalRequests > 0 ? Math.round((stats.closed / stats.totalRequests) * 100) : 0}%
            </span>
            <span className="text-[10px] text-slate-500 mt-0.5 block">{formatCount(stats.closed)} of {formatCount(stats.totalRequests)}</span>
          </div>
          <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600">
            <ShieldCheck size={20} />
          </div>
        </div>

        <div className="premium-card p-5 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Requests</span>
            <span className="text-xl font-black text-slate-800 mt-1 block">{formatCount(stats.totalRequests)}</span>
            <span className="text-[10px] text-slate-500 mt-0.5 block">{formatCount(stats.activeWork)} active work</span>
          </div>
          <div className="p-3 bg-amber-50 rounded-xl text-amber-600">
            <BarChart3 size={20} />
          </div>
        </div>
      </div>

      {/* Charts & Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Spending by Department */}
        <div className="premium-card p-6 space-y-4">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider pb-2 border-b border-slate-100">PO Value by Department</h3>
          <div className="space-y-3">
            {departmentData.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">No approved PO value available yet.</div>
            ) : (
              departmentData.map((d, idx) => {
                const percent = Math.round((d.cost / maxDeptCost) * 100)
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between text-xs font-medium text-slate-700">
                      <span className="truncate pr-2">{d.name}</span>
                      <span className="font-bold tabular-nums whitespace-nowrap">{formatCurrency(d.cost)}</span>
                    </div>
                    <div className="w-full h-2 rounded bg-slate-100 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded" style={{ width: `${percent}%` }}></div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Category Distribution */}
        <div className="premium-card p-6 space-y-4">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider pb-2 border-b border-slate-100">Category Distribution</h3>
          <div className="space-y-3">
            {categoryData.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs">No requests filed yet.</div>
            ) : (
              categoryData.map((c, idx) => {
                const percent = Math.round((c.value / maxCategoryVal) * 100)
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between text-xs font-medium text-slate-700">
                      <span className="truncate pr-2">{c.name}</span>
                      <span className="font-bold tabular-nums whitespace-nowrap">{formatCount(c.value)} reqs</span>
                    </div>
                    <div className="w-full h-2 rounded bg-slate-100 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded" style={{ width: `${percent}%` }}></div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Technician Task Logs */}
        <div className="premium-card p-6 space-y-4 lg:col-span-2">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider pb-2 border-b border-slate-100 flex items-center space-x-2">
            <Users size={16} />
            <span>Technician Task Logs</span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-750">
              <thead>
                <tr className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2">
                  <th className="pb-2">Technician Name</th>
                  <th className="pb-2 text-right">Assigned</th>
                  <th className="pb-2 text-right">Completed</th>
                  <th className="pb-2 text-right">Completion %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {technicianData.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="py-6 text-center text-slate-500 text-xs">No active technician assignments.</td>
                  </tr>
                ) : (
                  technicianData.map((t, idx) => {
                    const rate = t.assigned > 0 ? Math.round((t.completed / t.assigned) * 100) : 0
                    return (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="py-2.5 font-semibold text-slate-800">{t.name}</td>
                        <td className="py-2.5 text-right tabular-nums">{formatCount(t.assigned)}</td>
                        <td className="py-2.5 text-right tabular-nums">{formatCount(t.completed)}</td>
                        <td className="py-2.5 text-right font-bold text-violet-600">{rate}%</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Reports
