import { useState, useEffect } from 'react'
import apiClient from '../utils/apiClient'
import { Package, TrendingUp, AlertTriangle, MapPin, Search, Filter, Building2 } from 'lucide-react'
import { PageHeader } from '../components/ui'
import { ErrorState, LoadingState } from '../components/EmptyStates'
import { INSTITUTIONS } from '../constants/institutions'

const formatCurrency = value => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2
}).format(Number.isFinite(Number(value)) ? Number(value) : 0)

const formatCount = value => new Intl.NumberFormat('en-IN').format(Number.isFinite(Number(value)) ? Number(value) : 0)

const institutions = [
  { id: '', name: 'All institutions' },
  ...INSTITUTIONS.slice(0, 2),
  { id: 'mcw', name: 'MCW', logo: '/images/MCW logo.jpg' },
  ...INSTITUTIONS.slice(2)
]

const institutionColors = {
  msec: 'bg-violet-100 text-violet-700',
  nest: 'bg-emerald-100 text-emerald-700',
  mcw: 'bg-amber-100 text-amber-700',
  mssm: 'bg-rose-100 text-rose-700',
  iic: 'bg-sky-100 text-sky-700',
  unassigned: 'bg-slate-100 text-slate-600',
}

function Stock() {
  const [stockItems, setStockItems] = useState([])
  const [institutionSummary, setInstitutionSummary] = useState([])
  const [categorySummary, setCategorySummary] = useState([])
  const [totals, setTotals] = useState({ totalUniqueItems: 0, totalOrdered: 0, totalReceived: 0, totalPending: 0, totalValue: 0 })
  const [institutionFilter, setInstitutionFilter] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const fetchStock = async () => {
    setIsLoading(true)
    setLoadError('')
    try {
      const params = new URLSearchParams()
      if (institutionFilter) params.set('institution', institutionFilter)
      if (searchTerm) params.set('search', searchTerm)
      if (categoryFilter) params.set('category', categoryFilter)
      const qs = params.toString() ? `?${params.toString()}` : ''
      const res = await apiClient.get(`/api/stock${qs}`, { cache: false })
      if (!res.success) throw new Error(res.error || 'Stock data could not be loaded.')
      setStockItems(res.stockItems || [])
      setInstitutionSummary(res.institutionSummary || [])
      setCategorySummary(res.categorySummary || [])
      setTotals(res.totals || {})
    } catch (err) {
      setLoadError(err.message || 'Failed to retrieve stock data')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { fetchStock() }, [institutionFilter, categoryFilter])

  const handleSearch = (e) => {
    e.preventDefault()
    fetchStock()
  }

  if (isLoading) return <LoadingState label="Loading stock data..." />
  if (loadError) return <ErrorState message={loadError} onRetry={fetchStock} />

  const uniqueCategories = [...new Set(stockItems.map(i => i.category))].sort()

  return (
    <div className="space-y-6 page-enter text-left">
      <PageHeader
        title="Inventory & Stock"
        subtitle="Items purchased across institutions, with quantities and locations"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="premium-card p-4 flex items-center gap-3">
          <div className="p-2.5 bg-violet-50 rounded-xl text-violet-600">
            <Package size={18} />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Unique Items</span>
            <span className="text-lg font-black text-slate-800">{formatCount(totals.totalUniqueItems)}</span>
          </div>
        </div>
        <div className="premium-card p-4 flex items-center gap-3">
          <div className="p-2.5 bg-emerald-50 rounded-xl text-emerald-600">
            <TrendingUp size={18} />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Ordered</span>
            <span className="text-lg font-black text-slate-800">{formatCount(totals.totalOrdered)}</span>
          </div>
        </div>
        <div className="premium-card p-4 flex items-center gap-3">
          <div className="p-2.5 bg-amber-50 rounded-xl text-amber-600">
            <AlertTriangle size={18} />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Pending Delivery</span>
            <span className="text-lg font-black text-slate-800">{formatCount(totals.totalPending)}</span>
          </div>
        </div>
        <div className="premium-card p-4 flex items-center gap-3">
          <div className="p-2.5 bg-indigo-50 rounded-xl text-indigo-600">
            <MapPin size={18} />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Value</span>
            <span className="text-lg font-black text-slate-800">{formatCurrency(totals.totalValue)}</span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="premium-card p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <form onSubmit={handleSearch} className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search items..."
                className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
            </div>
            <button type="submit" className="px-4 py-2 bg-violet-600 text-white text-xs font-bold rounded-xl hover:bg-violet-700 transition-colors">
              Search
            </button>
          </form>
          {/* Category filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-violet-400 bg-white"
          >
            <option value="">All Categories</option>
            {uniqueCategories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
        {/* Institution filter */}
        <div className="border-t border-slate-100 pt-3">
          <div className="mb-2 flex items-center gap-2 text-slate-600">
            <Filter size={14} />
            <span className="text-[11px] font-bold uppercase tracking-wider">Institution</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {institutions.map(inst => (
            <button
              key={inst.id}
              onClick={() => setInstitutionFilter(inst.id)}
              aria-pressed={institutionFilter === inst.id}
              className={`flex min-h-[68px] items-center gap-3 rounded-xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                institutionFilter === inst.id
                  ? 'border-violet-400 bg-violet-50 shadow-md shadow-violet-600/15'
                  : 'border-slate-200 bg-white hover:border-violet-200 hover:bg-slate-50'
              }`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${institutionFilter === inst.id ? 'border-violet-200 bg-white' : 'border-slate-100 bg-slate-50'}`}>
                {inst.id ? <img src={inst.logo} alt="" className="h-6 w-6 object-contain" /> : <Building2 size={17} className="text-violet-600" />}
              </span>
              <span className={`text-xs font-black leading-tight ${institutionFilter === inst.id ? 'text-violet-700' : 'text-slate-700'}`}>{inst.name}</span>
            </button>
          ))}
          </div>
        </div>
      </div>

      {/* Institution Summary */}
      {institutionSummary.length > 0 && (
        <div className="premium-card p-5 space-y-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">By Institution</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {institutionSummary.map(inst => (
              <div
                key={inst.institution}
                onClick={() => setInstitutionFilter(inst.institution === institutionFilter ? '' : inst.institution)}
                className="p-3 rounded-xl border border-slate-100 hover:border-violet-200 hover:bg-violet-50/50 cursor-pointer transition-all"
              >
                <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${institutionColors[inst.institution] || 'text-slate-500'} inline-block px-2 py-0.5 rounded`}>
                  {inst.institution}
                </div>
                <div className="text-sm font-black text-slate-800">{formatCount(inst.uniqueItems)} items</div>
                <div className="text-[10px] text-slate-500">{formatCurrency(inst.totalValue)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category Summary */}
      {categorySummary.length > 0 && (
        <div className="premium-card p-5 space-y-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">By Category</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                  <th className="pb-2 pr-4">Category</th>
                  <th className="pb-2 text-right">Items</th>
                  <th className="pb-2 text-right">Ordered</th>
                  <th className="pb-2 text-right">Received</th>
                  <th className="pb-2 text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {categorySummary.map((cat, idx) => (
                  <tr
                    key={idx}
                    onClick={() => setCategoryFilter(cat.category === categoryFilter ? '' : cat.category)}
                    className="hover:bg-violet-50/50 cursor-pointer"
                  >
                    <td className="py-2 pr-4 font-semibold text-slate-700">{cat.category}</td>
                    <td className="py-2 text-right tabular-nums">{formatCount(cat.uniqueItems)}</td>
                    <td className="py-2 text-right tabular-nums">{formatCount(cat.totalOrdered)}</td>
                    <td className="py-2 text-right tabular-nums">{formatCount(cat.totalReceived)}</td>
                    <td className="py-2 text-right font-bold tabular-nums text-slate-700">{formatCurrency(cat.totalValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stock Items Table */}
      <div className="premium-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Stock Items ({stockItems.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                <th className="pb-2 pr-3">Item</th>
                <th className="pb-2 pr-3">Institution</th>
                <th className="pb-2 pr-3">Category</th>
                <th className="pb-2 pr-3">Location</th>
                <th className="pb-2 pr-3">Brand/Model</th>
                <th className="pb-2 text-right pr-3">Ordered</th>
                <th className="pb-2 text-right pr-3">Received</th>
                <th className="pb-2 text-right pr-3">Pending</th>
                <th className="pb-2 text-right pr-3">Unit Price</th>
                <th className="pb-2 text-right">Total Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {stockItems.length === 0 ? (
                <tr>
                  <td colSpan="10" className="py-12 text-center text-slate-500">No stock items found.</td>
                </tr>
              ) : (
                stockItems.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50">
                    <td className="py-2.5 pr-3 font-semibold text-slate-700 max-w-[200px] truncate" title={item.itemName}>{item.itemName}</td>
                    <td className="py-2.5 pr-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${institutionColors[item.institution] || 'bg-slate-100 text-slate-600'}`}>
                        {item.institution}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-slate-600">{item.category}</td>
                    <td className="py-2.5 pr-3 text-slate-600 max-w-[120px] truncate" title={item.location}>{item.location}</td>
                    <td className="py-2.5 pr-3 text-slate-500">
                      {item.brand && <span>{item.brand}</span>}
                      {item.model && <span className="text-slate-400"> {item.model}</span>}
                      {!item.brand && !item.model && <span className="text-slate-300">-</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums font-medium">{formatCount(item.totalOrdered)} {item.unit}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-emerald-600 font-medium">{formatCount(item.totalReceived)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      <span className={item.totalPending > 0 ? 'text-amber-600 font-bold' : 'text-slate-400'}>
                        {formatCount(item.totalPending)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">{formatCurrency(item.avgUnitPrice)}</td>
                    <td className="py-2.5 text-right font-bold tabular-nums text-slate-800">{formatCurrency(item.totalValue)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default Stock
