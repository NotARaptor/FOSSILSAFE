import { useNavigate } from "react-router-dom"
import { useState, useEffect } from "react"
import { api, Job, Tape } from "../lib/api"
import RestoreWizard from "@/components/RestoreWizard"
import ConfirmationModal from "@/components/ui/ConfirmationModal"
import PromptModal from "@/components/ui/PromptModal"
import {
    CassetteTape,
    Database,
    Activity,
    HardDrive,
    Cpu,
    MemoryStick,
    Grid,
    Server,
    ShieldCheck,
    AlertTriangle,
    Ban
} from "lucide-react"

import { useDemoMode } from "@/lib/demoMode"
import { ThroughputWidget } from "@/components/ThroughputWidget"
import { ContextPanel } from "@/components/ContextPanel"
import { useSocket } from "@/contexts/SocketProvider"
import { StagingHealthWidget } from "@/components/StagingHealthWidget"


interface DriveInfo {
    id: string;
    type: string;
    status: 'idle' | 'busy' | 'error' | 'offline' | 'reading' | 'writing';
    current_tape?: string;
}

interface SystemStats {
    cache_disk_percent: number;
    cpu_percent: number;
    ram_percent: number;
    total_capacity_bytes: number;
    used_capacity_bytes: number;
    tapes_online: number;
    total_slots: number;
    mailslot_enabled: boolean;
}

// Helper to get bar color based on usage percentage
const getResourceBarColor = (percent: number, isLive = true): string => {
    if (!isLive) return 'bg-white/5';
    if (percent === 0) return 'bg-[#27272a]';
    if (percent < 70) return 'bg-primary'; // Green - good
    if (percent < 85) return 'bg-warning'; // Yellow - warning
    return 'bg-destructive'; // Red - critical
};

// Helper to get icon color based on usage percentage
const getResourceIconColor = (percent: number, isLive = true): string => {
    if (!isLive) return 'text-[#3f3f46]';
    if (percent === 0) return 'text-[#3f3f46]';
    if (percent < 70) return 'text-primary'; // Green - good
    if (percent < 85) return 'text-warning'; // Yellow - warning
    return 'text-destructive'; // Red - critical
};

export default function DashboardPage() {
    const navigate = useNavigate();

    const { isDemoMode, mockStats, mockDrives, mockJobs, mockTapes } = useDemoMode();

    // STRICT MODE: Initialize with null/empty when NOT in demo mode
    const [stats, setStats] = useState<SystemStats | null>(isDemoMode ? (mockStats as any) : null);
    const [drives, setDrives] = useState<DriveInfo[]>(isDemoMode ? (mockDrives as any) : []);
    const [jobs, setJobs] = useState<Job[]>(isDemoMode ? mockJobs : []);
    const [driveHealth, setDriveHealth] = useState<Record<string, any>>({});
    const [activeJob, setActiveJob] = useState<Job | null>(isDemoMode ? mockJobs.find((j: Job) => j.status === 'running') || null : null);
    const [tapes, setTapes] = useState<Tape[]>(isDemoMode ? mockTapes : []);
    const [selectedBarcodes, setSelectedBarcodes] = useState<string[]>([]);
    const [lastClickedBarcode, setLastClickedBarcode] = useState<string | null>(null);
    const [loading, setLoading] = useState(!isDemoMode);
    const [isLive, setIsLive] = useState(isDemoMode);

    const [showRestoreWizard, setShowRestoreWizard] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);

    // Modal state
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        variant: 'danger' | 'info' | 'warning';
    }>({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: () => { },
        variant: 'info'
    });

    const [promptModal, setPromptModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        placeholder: string;
        onConfirm: (value: string) => void;
        variant: 'danger' | 'info';
    }>({
        isOpen: false,
        title: '',
        message: '',
        placeholder: '',
        onConfirm: () => { },
        variant: 'info'
    });

    const [eraseModal, setEraseModal] = useState<{
        isOpen: boolean;
        barcode: string;
        drive: number;
        mode: 'quick' | 'format' | 'secure';
        isBulk: boolean;
        barcodes: string[];
    }>({
        isOpen: false, barcode: '', drive: 0, mode: 'quick', isBulk: false, barcodes: []
    });

    const [draggingTape, setDraggingTape] = useState<Tape | null>(null);

    const handleDragStart = (tape: Tape) => {
        setDraggingTape(tape);
    };

    const handleTapeMove = async (barcode: string, destType: 'slot' | 'drive', destValue: number) => {
        const sourceTape = tapes.find(t => t.barcode === barcode);
        if (!sourceTape) return;

        const sourceLoc = sourceTape.location_type === 'drive'
            ? `Drive ${sourceTape.drive_id}`
            : `Slot ${String(sourceTape.slot_number || 0).padStart(3, '0')}`;

        const destLoc = destType === 'drive'
            ? `Drive ${destValue}`
            : `Slot ${String(destValue).padStart(3, '0')}`;

        setConfirmModal({
            isOpen: true,
            title: 'Confirm Physical Tape Move',
            message: `Move tape ${barcode} from ${sourceLoc} to ${destLoc}? This will trigger a physical move in the library changer.`,
            variant: 'info',
            onConfirm: async () => {
                if (isDemoMode) {
                    // Update local state for demo
                    if (destType === 'slot') {
                        const updatedTapes = tapes.map(t => t.barcode === barcode ? { ...t, slot_number: destValue, location_type: 'slot' } : t);
                        setTapes(updatedTapes as any);
                    } else {
                        // Simulate move to drive for demo
                        const updatedDrives = [...drives];
                        updatedDrives[destValue] = { ...updatedDrives[destValue], current_tape: barcode, status: 'idle' };
                        setDrives(updatedDrives);
                        const updatedTapes = tapes.map(t => t.barcode === barcode ? { ...t, location_type: 'drive', slot_number: destValue } : t);
                        setTapes(updatedTapes as any);
                    }
                    return;
                }

                try {
                    const res = await api.post('/api/tape/move', {
                        source: {
                            type: sourceTape.location_type || 'slot',
                            value: sourceTape.slot_number || 0
                        },
                        destination: {
                            type: destType,
                            value: destValue
                        }
                    });

                    if (res.success) {
                        // Refresh dashboard data
                        const fetchRes = await api.getTapes();
                        if (fetchRes.success && fetchRes.data) setTapes(fetchRes.data.tapes);
                    } else {
                        alert(`Move failed: ${res.error}`);
                    }
                } catch (e) {
                    console.error('Failed to move tape:', e);
                }
            }
        });
    };

    const fetchDashboardData = async () => {
        // In demo mode, use mock data and skip API calls
        if (isDemoMode) {
            setStats(mockStats as any);
            setDrives(mockDrives as any);
            setJobs(mockJobs);
            setTapes(mockTapes);
            setActiveJob(mockJobs.find((j: Job) => j.status === 'running') || null);
            setLoading(false);
            setIsLive(true);
            return;
        }

        setLoading(true);
        const newErrors: string[] = [];
        let telemetrySuccess = false;
        let currentTapes: Tape[] = [];
        let hasCapacity = false;

        // Fetch jobs
        const jobsRes = await api.getJobs(10);
        if (jobsRes.success && jobsRes.data) {
            setJobs(jobsRes.data.jobs);
            setActiveJob(jobsRes.data.jobs.find(j => j.status === 'running') || null);
            telemetrySuccess = true;
        } else {
            newErrors.push('Failed to load jobs');
        }

        // Fetch tapes
        const tapesRes = await api.getTapes();
        if (tapesRes.success && tapesRes.data) {
            currentTapes = tapesRes.data.tapes;
            setTapes(currentTapes);
            telemetrySuccess = true;
        } else {
            newErrors.push('Failed to load tapes');
        }

        // Fetch drive health
        const drivesRes = await api.getDriveHealth();
        if (drivesRes.success && drivesRes.data?.drives) {
            setDrives(drivesRes.data.drives.map(d => ({
                id: d.id,
                type: d.type,
                status: d.status as any,
                current_tape: d.current_tape
            })));
            telemetrySuccess = true;
        } else {
            newErrors.push('Failed to load drive status');
        }

        // Fetch predictive drive health (FS-02)
        const healthRes = await api.getPredictiveDriveHealth();
        if (healthRes.success && healthRes.data) {
            setDriveHealth(healthRes.data.data || {});
        }

        // Fetch system stats
        const statsRes = await api.getSystemStats();
        if (statsRes.success && statsRes.data) {
            // Map API response to our UI structure
            const apiData = statsRes.data as any;
            const totalCap = apiData.total_capacity_bytes ?? 0;
            hasCapacity = totalCap > 0;

            setStats({
                cache_disk_percent: apiData.cache_disk_percent ?? apiData.disk_percent ?? 0,
                cpu_percent: apiData.cpu_percent ?? 0,
                ram_percent: apiData.ram_percent ?? apiData.memory_percent ?? 0,
                total_capacity_bytes: totalCap,
                used_capacity_bytes: apiData.used_capacity_bytes ?? 0,
                tapes_online: apiData.tapes_online ?? 0,
                total_slots: apiData.total_slots ?? 0,
                mailslot_enabled: apiData.mailslot_enabled ?? false
            });

            // STRICT: Telemetry is only "Live" if we have reported capacity OR library inventory
            if (!hasCapacity && currentTapes.length === 0) {
                telemetrySuccess = false;
            } else {
                telemetrySuccess = true;
            }
        } else {
            // Calculate basic stats from tapes if available
            if (tapesRes.success && tapesRes.data?.tapes) {
                const tapesList = tapesRes.data.tapes;
                const onlineTapes = tapesList.filter((t: any) => t.status !== 'offline').length;
                setStats({
                    cache_disk_percent: 0,
                    cpu_percent: 0,
                    ram_percent: 0,
                    total_capacity_bytes: 0,
                    used_capacity_bytes: 0,
                    tapes_online: onlineTapes,
                    total_slots: tapesList.length,
                    mailslot_enabled: isDemoMode
                });
                telemetrySuccess = onlineTapes > 0;
            } else {
                newErrors.push('Failed to load system stats');
                if (!isDemoMode) setStats(null);
                telemetrySuccess = false;
            }
        }

        setIsLive(telemetrySuccess);
        setErrors(newErrors);
        setLoading(false);
    };

    const { socket } = useSocket();

    useEffect(() => {
        fetchDashboardData();
        // INTERVAL REMOVED: Polling replaced by WebSockets
    }, [isDemoMode]);

    useEffect(() => {
        if (!socket) return;

        const handleUpdate = () => {
            fetchDashboardData();
        };

        socket.on('state_update', handleUpdate);
        socket.on('job_status_change', handleUpdate);
        socket.on('tape_move_complete', handleUpdate);

        return () => {
            socket.off('state_update', handleUpdate);
            socket.off('job_status_change', handleUpdate);
            socket.off('tape_move_complete', handleUpdate);
        };
    }, [socket]);

    // Format byte values
    const formatBytes = (bytes: number) => {
        if (!bytes || bytes === 0) return "0 GB";
        if (bytes >= 1024 * 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024 * 1024 * 1024)).toFixed(1)} PB`;
        if (bytes >= 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(0)} TB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(0)} GB`;
    };

    const getTapeAtSlot = (slotNum: number) => {
        return tapes.find(t => t.location_type !== 'drive' && t.slot_number === slotNum);
    };

    const handleTapeClick = (tape: Tape, event: React.MouseEvent) => {
        if (!tape) return;

        if (event.shiftKey && lastClickedBarcode) {
            // Find indices in the current tapes list
            const lastIdx = tapes.findIndex(t => t.barcode === lastClickedBarcode);
            const currentIdx = tapes.findIndex(t => t.barcode === tape.barcode);

            if (lastIdx !== -1 && currentIdx !== -1) {
                const start = Math.min(lastIdx, currentIdx);
                const end = Math.max(lastIdx, currentIdx);
                const range = tapes.slice(start, end + 1).map(t => t.barcode);
                setSelectedBarcodes(prev => Array.from(new Set([...prev, ...range])));
            }
        } else if (event.ctrlKey || event.metaKey) {
            setSelectedBarcodes(prev =>
                prev.includes(tape.barcode)
                    ? prev.filter(b => b !== tape.barcode)
                    : [...prev, tape.barcode]
            );
        } else {
            setSelectedBarcodes([tape.barcode]);
            setSelectedTape(tape); // Keep single tape selection for ContextPanel compatibility
        }
        setLastClickedBarcode(tape.barcode);
    };

    const [selectedTape, setSelectedTape] = useState<Tape | null>(null);

    const getTapeStatus = (slotNum: number) => {
        const tape = getTapeAtSlot(slotNum);
        if (!tape) return 'empty';
        if (tape.status === 'offline') return 'offline';
        if (tape.status === 'in_use') return 'busy';
        if (tape.status === 'error') return 'error';
        return 'online';
    };

    // Loading state
    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="flex flex-col items-center gap-4">
                    <span className="material-symbols-outlined text-4xl text-primary animate-spin">sync</span>
                    <span className="text-muted-foreground font-mono text-sm uppercase tracking-wider">Loading Dashboard...</span>
                </div>
            </div>
        );
    }

    // Error state (no data at all)
    if (!stats && tapes.length === 0 && jobs.length === 0) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="flex flex-col items-center gap-4 text-center">
                    <span className="material-symbols-outlined text-4xl text-destructive">error</span>
                    <span className="text-white font-bold">Failed to Load Dashboard</span>
                    <span className="text-muted-foreground text-sm max-w-md">
                        Could not connect to the backend API. Please ensure the backend is running and try again.
                    </span>
                    {errors.length > 0 && (
                        <div className="text-xs text-destructive font-mono mt-2">
                            {errors.join(' | ')}
                        </div>
                    )}
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-4 px-4 py-2 bg-primary/10 border border-primary/30 text-primary hover:bg-primary hover:text-black rounded text-sm font-bold transition-all"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    const usedCapacity = stats ? formatBytes(stats.used_capacity_bytes) : '0 GB';
    const totalCapacity = stats ? formatBytes(stats.total_capacity_bytes) : '0 GB';
    const usedPercent = stats && stats.total_capacity_bytes > 0
        ? ((stats.used_capacity_bytes / stats.total_capacity_bytes) * 100).toFixed(1)
        : '0.0';
    const totalSlots = stats?.total_slots || (tapes.length > 0 ? tapes.length : 0);

    return (
        <div className="flex flex-col gap-6">

            {/* Error Banner if partial failures */}
            {errors.length > 0 && (
                <div className="bg-warning/10 border border-warning/30 rounded-md px-4 py-2 text-warning text-xs font-mono">
                    ⚠ Some data unavailable: {errors.join(', ')}
                </div>
            )}

            {/* KPI Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {/* Card 1: Tapes Online */}
                <div className="bg-[#121214] border border-[#27272a] rounded-md p-4 flex flex-col justify-between group hover:border-primary/30 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-muted-foreground text-[10px] uppercase font-bold tracking-widest text-[#71717a]">Tapes Online</span>
                        <CassetteTape className={`size-5 ${isLive ? 'text-primary' : 'text-[#3f3f46]'}`} />
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-bold font-mono text-white">{stats?.tapes_online ?? tapes.filter(t => t.status !== 'offline').length}</span>
                        <span className="text-xs text-muted-foreground font-mono">/ {totalSlots > 0 ? totalSlots : '--'} Slots</span>
                    </div>
                    <div className={`mt-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${isLive ? 'text-primary' : 'text-[#3f3f46]'}`}>
                        <Activity className="size-3.5" />
                        <span>{tapes.filter(t => t.status === 'in_use').length} in use</span>
                        <span className="text-[#71717a] font-normal lowercase ml-1">now</span>
                    </div>
                </div>

                <ThroughputWidget job={activeJob} />
                <StagingHealthWidget job={activeJob} />

                {/* Card 3: Archive Capacity */}
                <div className="bg-[#121214] border border-[#27272a] rounded-md p-4 flex flex-col justify-between group hover:border-primary/30 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-muted-foreground text-[10px] uppercase font-bold tracking-widest text-[#71717a]">Archive Capacity</span>
                        <Database className="text-muted-foreground size-5" />
                    </div>
                    <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold font-mono text-white">{usedCapacity.split(' ')[0]}</span>
                        <span className="text-xs text-muted-foreground font-mono">{usedCapacity.split(' ')[1] || ''} / {totalCapacity}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
                        <span className="text-[#71717a]">{usedPercent}% Full</span>
                        <div className="flex items-center gap-1.5">
                            <span className={cn("size-1.5 rounded-full", isLive ? "bg-primary animate-pulse shadow-[0_0_5px_rgba(25,230,100,0.5)]" : "bg-destructive")}></span>
                            <span className={isLive ? "text-primary" : "text-destructive"}>{isLive ? 'Live' : 'Offline'}</span>
                        </div>
                    </div>
                </div>

                {/* Card 4: System Resources */}
                <div className="bg-[#121214] border border-[#27272a] rounded-md p-4 flex flex-col justify-between group hover:border-primary/30 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-muted-foreground text-[10px] uppercase font-bold tracking-widest text-[#71717a]">System Resources</span>
                        <Activity className="text-muted-foreground size-5" />
                    </div>
                    <div className="flex flex-col gap-2 mt-1">
                        {/* Cache Disk - Largest */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 w-16">
                                <HardDrive className={`size-3.5 flex-shrink-0 ${getResourceIconColor(stats?.cache_disk_percent ?? 0, isLive)}`} />
                                <span className="text-[10px] text-muted-foreground font-mono uppercase">Cache</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-24 h-2 bg-[#27272a] rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full transition-all ${getResourceBarColor(stats?.cache_disk_percent ?? 0, isLive)}`} style={{ width: `${stats?.cache_disk_percent ?? 0}%` }}></div>
                                </div>
                                <span className="text-sm font-mono text-white w-10 text-right">{stats?.cache_disk_percent ?? '--'}%</span>
                            </div>
                        </div>
                        {/* CPU */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 w-16">
                                <Cpu className={`size-3.5 flex-shrink-0 ${getResourceIconColor(stats?.cpu_percent ?? 0, isLive)}`} />
                                <span className="text-[10px] text-muted-foreground font-mono uppercase">CPU</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-24 h-2 bg-[#27272a] rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full transition-all ${getResourceBarColor(stats?.cpu_percent ?? 0, isLive)}`} style={{ width: `${stats?.cpu_percent ?? 0}%` }}></div>
                                </div>
                                <span className="text-sm font-mono text-white w-10 text-right">{stats?.cpu_percent ?? '--'}%</span>
                            </div>
                        </div>
                        {/* RAM */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 w-16">
                                <MemoryStick className={`size-3.5 flex-shrink-0 ${getResourceIconColor(stats?.ram_percent ?? 0, isLive)}`} />
                                <span className="text-[10px] text-muted-foreground font-mono uppercase">RAM</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-24 h-2 bg-[#27272a] rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full transition-all ${getResourceBarColor(stats?.ram_percent ?? 0, isLive)}`} style={{ width: `${stats?.ram_percent ?? 0}%` }}></div>
                                </div>
                                <span className="text-sm font-mono text-white w-10 text-right">{stats?.ram_percent ?? '--'}%</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Two Column Layout: Visualizer & Details */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Tape Visualizer */}
                <div className="lg:col-span-2 bg-[#121214] border border-[#27272a] rounded-md flex flex-col">
                    <div className="px-4 py-3 border-b border-[#27272a] flex justify-between items-center bg-[#18181b]/50">
                        <h2 className="text-[10px] font-bold text-white uppercase tracking-[0.2em] flex items-center gap-2">
                            <Grid className="text-primary size-3.5" />
                            Library Matrix
                        </h2>
                        <div className="flex gap-4 text-[9px] uppercase font-bold tracking-wider text-muted-foreground">
                            <div className="flex items-center gap-1.5"><div className="size-2 rounded-sm bg-primary/40 border border-primary/60"></div> Online</div>
                            <div className="flex items-center gap-1.5"><div className="size-2 rounded-sm bg-warning/40 border border-warning/60"></div> Busy</div>
                            <div className="flex items-center gap-1.5"><div className="size-2 rounded-sm bg-destructive/40 border border-destructive/60"></div> Error</div>
                            <div className="flex items-center gap-1.5"><div className="size-2 rounded-sm bg-[#27272a]"></div> Empty</div>
                        </div>
                    </div>
                    <div className="p-5">
                        {tapes.length === 0 ? (
                            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                                No tape data available
                            </div>
                        ) : (
                            <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-12 gap-2">
                                {Array.from({ length: totalSlots }).map((_, i) => {
                                    const slotNum = i + 1;
                                    const status = getTapeStatus(slotNum);
                                    const tape = getTapeAtSlot(slotNum);
                                    return (
                                        <div
                                            key={i}
                                            onClick={(e) => tape && handleTapeClick(tape, e)}
                                            draggable={!!tape}
                                            onDragStart={() => tape && handleDragStart(tape)}
                                            onDragOver={(e) => {
                                                e.preventDefault();
                                                if (draggingTape && !tape) {
                                                    e.currentTarget.classList.add('border-primary');
                                                    e.currentTarget.classList.add('bg-primary/5');
                                                }
                                            }}
                                            onDragLeave={(e) => {
                                                e.currentTarget.classList.remove('border-primary');
                                                e.currentTarget.classList.remove('bg-primary/5');
                                            }}
                                            onDrop={(e) => {
                                                e.preventDefault();
                                                e.currentTarget.classList.remove('border-primary');
                                                e.currentTarget.classList.remove('bg-primary/5');
                                                if (draggingTape && !tape) {
                                                    handleTapeMove(draggingTape.barcode, 'slot', slotNum);
                                                    setDraggingTape(null);
                                                }
                                            }}
                                            className={cn(
                                                "aspect-[3/4] rounded-sm flex items-center justify-center relative group cursor-pointer transition-all border",
                                                selectedBarcodes.includes(tape?.barcode || '') ? "ring-2 ring-primary ring-offset-1 ring-offset-black z-10" : "",
                                                status === 'busy' ? "bg-warning/10 border-warning text-warning animate-pulse" :
                                                    status === 'error' ? "bg-destructive/10 border-destructive text-destructive" :
                                                        status === 'offline' ? "bg-[#18181b] border-[#27272a] text-[#3f3f46]" :
                                                            status === 'empty' ? "bg-[#27272a]/20 border-white/5 text-[#27272a] cursor-default" :
                                                                "bg-primary/10 border-primary/30 text-primary-dim hover:bg-primary/20 hover:border-primary shadow-[0_0_15px_rgba(25,230,100,0.05)]"
                                            )}
                                        >
                                            <span className={cn(
                                                "text-[8px] font-mono absolute top-0.5 left-1 font-bold",
                                                status === 'empty' ? "text-[#3f3f46]" : "text-white/60"
                                            )}>{String(slotNum).padStart(2, '0')}</span>
                                            {status !== 'empty' && (
                                                <CassetteTape className="size-5" />
                                            )}
                                            {/* Tooltip on hover */}
                                            {tape && (
                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-[#18181b] border border-[#27272a] rounded text-[8px] font-bold text-white uppercase tracking-wider whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-xl flex items-center gap-1">
                                                    {tape.trust_status === 'trusted' && <ShieldCheck className="size-2.5 text-primary" />}
                                                    {tape.trust_status === 'untrusted' && <AlertTriangle className="size-2.5 text-destructive" />}
                                                    {tape.trust_status === 'partial' && <Ban className="size-2.5 text-warning" />}
                                                    {tape.barcode} {tape.alias ? `| ${tape.alias}` : ''}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Drive Status / Quick Actions */}
                <div className="bg-[#121214] border border-[#27272a] rounded-md flex flex-col h-full">
                    <div className="px-4 py-3 border-b border-[#27272a] bg-[#18181b]/50">
                        <h2 className="text-[10px] font-bold text-white uppercase tracking-[0.2em] flex items-center gap-2">
                            <Server className="text-primary size-3.5" />
                            Drive Status
                        </h2>
                    </div>
                    <div className="p-4 flex flex-col gap-4 flex-1">
                        {drives.length === 0 ? (
                            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                                No drive data available
                            </div>
                        ) : (
                            drives.map((drive, i) => (
                                <div
                                    key={i}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        if (draggingTape && !drive.current_tape) {
                                            e.currentTarget.classList.add('border-primary/50');
                                            e.currentTarget.classList.add('bg-primary/5');
                                        }
                                    }}
                                    onDragLeave={(e) => {
                                        e.currentTarget.classList.remove('border-primary/50');
                                        e.currentTarget.classList.remove('bg-primary/5');
                                    }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        e.currentTarget.classList.remove('border-primary/50');
                                        e.currentTarget.classList.remove('bg-primary/5');
                                        if (draggingTape && !drive.current_tape) {
                                            handleTapeMove(draggingTape.barcode, 'drive', i);
                                            setDraggingTape(null);
                                        }
                                    }}
                                    className="bg-[#18181b] border border-[#27272a] rounded p-3 relative overflow-hidden group transition-all"
                                >
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="font-mono text-[10px] text-white font-bold tracking-wider">{drive.id} [{drive.type}]</span>
                                        <span className={cn(
                                            "text-[8px] px-1.5 py-0.5 rounded border font-bold uppercase",
                                            drive.status === 'busy' ? "bg-warning/20 text-warning border-warning/20" :
                                                drive.status === 'error' ? "bg-destructive/20 text-destructive border-destructive/20" :
                                                    "bg-primary/20 text-primary border-primary/20"
                                        )}>
                                            {drive.status === 'busy' ? 'Writing' : drive.status === 'idle' ? 'Idle' : drive.status}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className={cn(
                                            "material-symbols-outlined text-sm",
                                            drive.status === 'busy' ? "text-warning animate-spin" : "text-primary"
                                        )}>
                                            {drive.status === 'busy' ? 'settings' : 'check_circle'}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground truncate uppercase font-bold tracking-wider">
                                            {drive.current_tape ? `Job: ${drive.current_tape}` : 'Ready for task'}
                                        </span>
                                    </div>

                                    {/* Drive Health Score (FS-02) */}
                                    {driveHealth[drive.id] && (
                                        <div className="mb-3 px-2 py-1 bg-black/20 rounded flex items-center justify-between">
                                            <div className="flex items-center gap-1.5">
                                                <span className={cn(
                                                    "size-1.5 rounded-full",
                                                    driveHealth[drive.id].status === 'healthy' ? "bg-primary" :
                                                        driveHealth[drive.id].status === 'degraded' ? "bg-warning" : "bg-destructive"
                                                )}></span>
                                                <span className="text-[9px] font-bold text-white uppercase tracking-tighter">Health Score</span>
                                            </div>
                                            <span className={cn(
                                                "font-mono text-[10px] font-black",
                                                driveHealth[drive.id].status === 'healthy' ? "text-primary" :
                                                    driveHealth[drive.id].status === 'degraded' ? "text-warning" : "text-destructive"
                                            )}>{driveHealth[drive.id].score}%</span>
                                        </div>
                                    )}

                                    <div className="w-full bg-[#09090b] rounded-full h-1">
                                        <div className={cn(
                                            "h-full rounded-full",
                                            drive.status === 'busy' ? "bg-warning animate-pulse" : "bg-primary"
                                        )} style={{ width: drive.status === 'busy' ? '45%' : '0%' }}></div>
                                    </div>
                                    <div className={cn(
                                        "absolute right-0 top-0 bottom-0 w-1",
                                        drive.status === 'busy' ? "bg-warning" : "bg-primary"
                                    )}></div>

                                    {/* Manual Controls Overlay (visible on group hover) */}
                                    <div className="absolute inset-x-0 bottom-0 bg-[#09090b]/95 border-t border-[#27272a] translate-y-full group-hover:translate-y-0 transition-transform flex items-center justify-around p-2 gap-2">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setConfirmModal({
                                                    isOpen: true,
                                                    title: 'Unload Tape',
                                                    message: `Unload tape from ${drive.id}? The tape will be moved back to its library slot.`,
                                                    variant: 'info',
                                                    onConfirm: () => {
                                                        api.unloadTape(i).then(res => {
                                                            if (!res.success) console.error('Failed to unload: ' + res.error);
                                                        });
                                                    }
                                                });
                                            }}
                                            disabled={drive.status === 'busy' || !drive.current_tape}
                                            className="flex-1 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] text-[#71717a] hover:text-white rounded text-[8px] font-bold uppercase tracking-wider flex items-center justify-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed"
                                            title="Unload Tape to Slot"
                                        >
                                            <span className="material-symbols-outlined text-[14px]">eject</span>
                                            Unload
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setEraseModal({
                                                    isOpen: true,
                                                    barcode: drive.current_tape || '',
                                                    drive: i,
                                                    mode: 'quick',
                                                    isBulk: false,
                                                    barcodes: []
                                                });
                                            }}
                                            disabled={drive.status === 'busy' || !drive.current_tape}
                                            className="flex-1 py-1.5 bg-destructive/10 hover:bg-destructive border border-destructive/20 text-destructive hover:text-white rounded text-[8px] font-bold uppercase tracking-wider flex items-center justify-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed"
                                            title="Erase/Format Tape"
                                        >
                                            <span className="material-symbols-outlined text-[14px]">format_underlined</span>
                                            Erase
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Quick Action Area */}
                    <div className="p-4 border-t border-[#27272a] bg-[#18181b]/50">
                        <button
                            onClick={() => navigate('/jobs')}
                            className="w-full flex items-center justify-center gap-2 py-2 rounded text-[10px] font-bold transition-all uppercase tracking-[0.15em] border bg-primary/10 border-primary/30 text-primary hover:bg-primary hover:text-black"
                        >
                            <span className="material-symbols-outlined text-sm">add</span>
                            Queue New Job
                        </button>
                    </div>
                </div>
            </div>

            {/* Recent Activity Table */}
            <div className="bg-[#121214] border border-[#27272a] rounded-md flex flex-col mb-6">
                <div className="px-4 py-3 border-b border-[#27272a] flex justify-between items-center bg-[#18181b]/50">
                    <h2 className="text-[10px] font-bold text-white uppercase tracking-[0.2em] flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary text-sm">history</span>
                        Event Log
                    </h2>
                    <button
                        onClick={() => navigate('/jobs')}
                        className="text-[10px] text-muted-foreground hover:text-white flex items-center gap-1 transition-colors font-bold uppercase tracking-wider"
                    >
                        View All
                        <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </button>
                </div>
                <div className="overflow-x-auto">
                    {jobs.length === 0 ? (
                        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                            No job data available
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-[#18181b]/30 text-[9px] uppercase text-muted-foreground font-bold tracking-widest">
                                <tr>
                                    <th className="px-4 py-3 border-b border-[#27272a]">Job ID</th>
                                    <th className="px-4 py-3 border-b border-[#27272a]">Type</th>
                                    <th className="px-4 py-3 border-b border-[#27272a]">Status</th>
                                    <th className="px-4 py-3 border-b border-[#27272a]">Progress</th>
                                    <th className="px-4 py-3 border-b border-[#27272a] text-right">Time</th>
                                </tr>
                            </thead>
                            <tbody className="text-[11px] divide-y divide-[#27272a] font-medium tracking-wide">
                                {jobs.slice(0, 5).map((job) => (
                                    <tr key={job.id} className="group hover:bg-white/5 transition-colors">
                                        <td className="px-4 py-3 font-mono text-white group-hover:text-primary transition-colors">JOB-{job.id}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <span className="material-symbols-outlined text-muted-foreground text-[14px]">
                                                    {job.type === 'backup' ? 'cloud_upload' : job.type === 'verify' ? 'verified' : 'restore'}
                                                </span>
                                                <span className="uppercase text-[10px] font-bold tracking-wider">{job.type}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={cn(
                                                "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border relative overflow-hidden transition-all",
                                                job.status === 'completed' ? "bg-primary/10 text-primary border-primary/20" :
                                                    job.status === 'running' ? "bg-primary/5 text-primary border-primary/50 shadow-[0_0_10px_rgba(25,230,100,0.2)] animate-pulse" :
                                                        job.status === 'failed' ? "bg-destructive/10 text-destructive border-destructive/20" :
                                                            job.status === 'queued_waiting_media' || job.status === 'waiting_for_drive' ? "bg-warning/10 text-warning border-warning/30" :
                                                                job.status === 'queued' ? "bg-primary/5 text-primary/70 border-primary/20" :
                                                                    "bg-muted/10 text-muted-foreground border-muted/20"
                                            )}>
                                                {(job.status === 'running' || job.status === 'queued_waiting_media') && (
                                                    <span className="absolute inset-0 border-2 border-primary/40 rounded animate-pulse"></span>
                                                )}
                                                <span className="size-1 rounded-full"
                                                    style={{
                                                        backgroundColor:
                                                            job.status === 'completed' ? 'var(--color-primary)' :
                                                                job.status === 'running' ? 'var(--color-primary)' :
                                                                    job.status === 'failed' ? 'var(--color-destructive)' :
                                                                        job.status === 'queued_waiting_media' || job.status === 'waiting_for_drive' ? 'var(--color-warning)' :
                                                                            'var(--color-muted-foreground)'
                                                    }}
                                                ></span>
                                                {job.status ? job.status.replace(/_/g, ' ') : ''}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-muted-foreground">{job.progress}%</td>
                                        <td className="px-4 py-3 text-right text-muted-foreground font-mono">
                                            {new Date(job.created_at).toLocaleTimeString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
            {/* Tape Detail Side Panel (ContextPanel) */}
            <ContextPanel
                tape={selectedTape}
                isOpen={!!selectedTape}
                onClose={() => setSelectedTape(null)}
                onRestore={() => setShowRestoreWizard(true)}
                showViewAction={true}
            />

            {/* Backdrop for detail panel */}
            {selectedTape && (
                <div
                    className="fixed inset-0 bg-black/40 z-40 transition-opacity duration-300"
                    onClick={() => setSelectedTape(null)}
                />
            )}
            {/* Restore Wizard */}
            <RestoreWizard
                isOpen={showRestoreWizard}
                onClose={() => setShowRestoreWizard(false)}
                onSuccess={() => {
                    // Logic to refresh or navigate
                    navigate('/jobs')
                }}
            />
            {/* Modals */}
            <ConfirmationModal
                isOpen={confirmModal.isOpen}
                onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                onConfirm={confirmModal.onConfirm}
                title={confirmModal.title}
                message={confirmModal.message}
                variant={confirmModal.variant}
            />

            <PromptModal
                isOpen={promptModal.isOpen}
                onClose={() => setPromptModal(prev => ({ ...prev, isOpen: false }))}
                onConfirm={promptModal.onConfirm}
                title={promptModal.title}
                message={promptModal.message}
                placeholder={promptModal.placeholder}
                variant={promptModal.variant}
                confirmText="Confirm Action"
            />
            {/* Bulk Actions Bar */}
            {selectedBarcodes.length > 1 && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-8 duration-500">
                    <div className="bg-[#18181b]/90 backdrop-blur-md border border-primary/30 rounded-full px-6 py-3 shadow-[0_0_50px_rgba(25,230,100,0.15)] flex items-center gap-6">
                        <div className="flex items-center gap-2 pr-6 border-r border-white/10">
                            <span className="text-primary font-bold font-mono text-lg">{selectedBarcodes.length}</span>
                            <span className="text-[10px] text-[#71717a] font-bold uppercase tracking-widest">Tapes Selected</span>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => {
                                    setConfirmModal({
                                        isOpen: true,
                                        title: 'Bulk Format Tapes',
                                        message: `Are you sure you want to format ${selectedBarcodes.length} tapes? All data on these tapes will be permanently erased.`,
                                        variant: 'warning',
                                        onConfirm: async () => {
                                            try {
                                                const res = await api.post('/api/library/bulk-format', { barcodes: selectedBarcodes })
                                                if (res.success) {
                                                    setSelectedBarcodes([])
                                                    alert("Bulk format started.")
                                                }
                                            } catch (e: any) {
                                                alert("Action failed: " + e.message)
                                            }
                                        }
                                    })
                                }}
                                className="px-4 py-1.5 bg-primary/10 hover:bg-primary hover:text-black border border-primary/30 text-primary rounded-full text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-1.5"
                            >
                                <span className="material-symbols-outlined text-[16px]">format_underlined</span>
                                Format
                            </button>

                            <button
                                onClick={() => {
                                    setEraseModal({
                                        isOpen: true,
                                        barcode: '',
                                        drive: 0,
                                        mode: 'quick',
                                        isBulk: true,
                                        barcodes: [...selectedBarcodes]
                                    });
                                }}
                                className="px-4 py-1.5 bg-destructive/10 hover:bg-destructive text-destructive hover:text-white border border-destructive/30 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-1.5"
                            >
                                <span className="material-symbols-outlined text-[16px]">delete_forever</span>
                                Erase
                            </button>

                            <button
                                onClick={() => setSelectedBarcodes([])}
                                className="px-3 py-1.5 text-[#71717a] hover:text-white text-[10px] font-bold uppercase tracking-widest"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Erase Mode Selection Modal */}
            {eraseModal.isOpen && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setEraseModal(prev => ({ ...prev, isOpen: false }))}>
                    <div className="bg-[#121214] border border-[#27272a] rounded-lg w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="p-4 border-b border-[#27272a]">
                            <h3 className="text-white text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                                <span className="material-symbols-outlined text-destructive text-lg">warning</span>
                                {eraseModal.isBulk ? `Erase ${eraseModal.barcodes.length} Tapes` : `Erase ${eraseModal.barcode}`}
                            </h3>
                        </div>
                        <div className="p-4 space-y-3">
                            <p className="text-[11px] text-[#71717a] uppercase tracking-wider font-bold mb-2">Select Erase Mode</p>
                            {([
                                { value: 'quick' as const, label: 'Quick Erase', time: '~5 seconds', desc: 'Writes EOD marker at start of tape. Data not physically removed.', icon: 'bolt' },
                                { value: 'format' as const, label: 'Reformat (LTFS)', time: '~30 seconds', desc: 'Reinitializes LTFS filesystem. Tape ready for immediate use.', icon: 'format_paint' },
                                { value: 'secure' as const, label: 'Secure Erase', time: '4-10 hours', desc: 'Full physical overwrite. Forensically unrecoverable.', icon: 'shield_lock' },
                            ]).map(opt => (
                                <button
                                    key={opt.value}
                                    onClick={() => setEraseModal(prev => ({ ...prev, mode: opt.value }))}
                                    className={`w-full text-left p-3 rounded-md border transition-all ${eraseModal.mode === opt.value
                                        ? 'border-primary bg-primary/10 text-white'
                                        : 'border-[#27272a] bg-[#18181b] text-[#a1a1aa] hover:border-[#3f3f46]'
                                        }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className={`material-symbols-outlined text-base ${eraseModal.mode === opt.value ? 'text-primary' : 'text-[#52525b]'}`}>{opt.icon}</span>
                                            <span className="text-xs font-bold uppercase tracking-wider">{opt.label}</span>
                                        </div>
                                        <span className={`text-[10px] font-mono ${eraseModal.mode === opt.value ? 'text-primary' : 'text-[#52525b]'}`}>{opt.time}</span>
                                    </div>
                                    <p className="text-[10px] text-[#71717a] mt-1 ml-7">{opt.desc}</p>
                                </button>
                            ))}
                        </div>
                        <div className="p-4 border-t border-[#27272a]">
                            <p className="text-[10px] text-destructive font-mono mb-2">
                                {eraseModal.isBulk
                                    ? `Type BULK_WIPE to confirm erasing ${eraseModal.barcodes.length} tapes.`
                                    : `Type the barcode "${eraseModal.barcode}" to confirm.`
                                }
                            </p>
                            <form onSubmit={async (e) => {
                                e.preventDefault();
                                const input = (e.currentTarget.elements.namedItem('confirm') as HTMLInputElement).value;
                                const expected = eraseModal.isBulk ? 'BULK_WIPE' : eraseModal.barcode;
                                if (input !== expected) return;

                                try {
                                    if (eraseModal.isBulk) {
                                        const res = await api.post('/api/library/bulk-wipe', {
                                            barcodes: eraseModal.barcodes,
                                            confirmation: 'BULK_WIPE',
                                            erase_mode: eraseModal.mode
                                        });
                                        if (res.success) {
                                            setSelectedBarcodes([]);
                                            setEraseModal(prev => ({ ...prev, isOpen: false }));
                                        }
                                    } else {
                                        const res = await api.wipeTape(eraseModal.barcode, eraseModal.drive, eraseModal.mode);
                                        if (!res.success) console.error('Erase failed:', res.error);
                                        setEraseModal(prev => ({ ...prev, isOpen: false }));
                                    }
                                } catch (err: any) {
                                    alert('Erase failed: ' + err.message);
                                }
                            }}>
                                <div className="flex gap-2">
                                    <input
                                        name="confirm"
                                        type="text"
                                        placeholder={eraseModal.isBulk ? 'Type BULK_WIPE...' : 'Type barcode...'}
                                        autoFocus
                                        className="flex-1 bg-[#18181b] border border-[#27272a] rounded px-3 py-2 text-white text-xs font-mono placeholder:text-[#3f3f46] focus:outline-none focus:border-primary"
                                    />
                                    <button
                                        type="submit"
                                        className="px-4 py-2 bg-destructive hover:bg-destructive/80 text-white rounded text-[10px] font-bold uppercase tracking-wider transition-colors"
                                    >
                                        Confirm
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setEraseModal(prev => ({ ...prev, isOpen: false }))}
                                        className="px-3 py-2 text-[#71717a] hover:text-white text-[10px] font-bold uppercase tracking-wider"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function cn(...inputs: any[]) {
    return inputs.filter(Boolean).join(' ');
}
