// renderer.js
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    CircularProgress,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    Box,
    Typography,
    Paper,
    IconButton,
    Tooltip
} from '@mui/material'; // prettier-ignore
import { Folder as FolderIcon, Description as DescriptionIcon, ArrowUpward as ArrowUpwardIcon, Refresh as RefreshIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { MaterialReactTable, useMaterialReactTable } from 'material-react-table';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';

// Assuming window.api is exposed by preload.js
const api = window.api;

// Helper function (can be moved to a utils file)
function getParentPath(filePath) {
    if (!filePath || filePath === '/') return null;
    let pathStr = filePath.endsWith('/') ? filePath.slice(0, -1) : filePath;
    const lastSlash = pathStr.lastIndexOf('/');
    if (lastSlash < 0) return null;
    if (lastSlash === 0) return '/';
    return pathStr.substring(0, lastSlash) + '/';
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === undefined || bytes === null || bytes < 0) return '';
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

const App = () => {
    const [devices, setDevices] = useState([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState('');
    const [status, setStatus] = useState(''); // Can still be used for general status
    const [isLoading, setIsLoading] = useState(false);

    const [browserFiles, setBrowserFiles] = useState([]);
    const [currentBrowserPath, setCurrentBrowserPath] = useState('/sdcard/');

    // Modal state (remains the same)
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalContentSrc, setModalContentSrc] = useState('');
    const [modalStatusText, setModalStatusText] = useState(''); // Renamed to avoid conflict
    const [previewContentType, setPreviewContentType] = useState(null); // 'image', 'video', or null
    const [currentPreviewFile, setCurrentPreviewFile] = useState({ deviceId: null, remotePath: null, localTempPath: null });
    const [isDownloadingZip, setIsDownloadingZip] = useState(false);
    // State for delete confirmation
    const [isConfirmDeleteDialogOpen, setIsConfirmDeleteDialogOpen] = useState(false);
    const [fileToDelete, setFileToDelete] = useState(null);
    const [deleteStatus, setDeleteStatus] = useState('');
    // State for batch delete confirmation
    const [isConfirmBatchDeleteDialogOpen, setIsConfirmBatchDeleteDialogOpen] = useState(false);
    const [filesToDeleteInBatch, setFilesToDeleteInBatch] = useState([]);
    const [batchDeleteStatus, setBatchDeleteStatus] = useState('');
    const videoRef = useRef(null); // Ref for the video element


    useEffect(() => {
        window.api.listDevices().then(deviceIds => {
            setDevices(deviceIds || []);
            if ((deviceIds || []).length === 0) {
                setStatus('No ADB devices found.');
            } else {
                setStatus('Please select a device.');
            }
        }).catch(err => {
            console.error("Failed to list devices:", err);
            setStatus('Failed to list devices.');
        });
    }, []);

    const loadDirectoryContents = useCallback(async (pathToList) => {
        if (!selectedDeviceId) {
            setStatus('Please select a device.');
            setBrowserFiles([]);
            return;
        }
        setIsLoading(true);
        setStatus(`Loading ${pathToList}...`);

        try {
            const entries = await window.api.listFolder(selectedDeviceId, pathToList);
            if (entries.error) {
                setStatus(`Error: ${entries.error}`);
                setBrowserFiles([]);
            } else if (Array.isArray(entries)) {
                const newFiles = entries
                    .filter(entry => entry.name !== '.' && entry.name !== '..')
                    .map(entry => {
                        const isDir = entry.isDirectory;
                        const key = pathToList.endsWith('/') ? `${pathToList}${entry.name}` : `${pathToList}/${entry.name}`;
                        return {
                            name: entry.name,
                            key: isDir ? `${key}/` : key,
                            modified: entry.mtime ? new Date(entry.mtime) : null,
                            size: entry.size, // adbkit provides 'size'
                        };
                    });
                setBrowserFiles(newFiles);
                setStatus(`Contents of ${pathToList}`);
            }
        } catch (err) {
            setStatus(`Failed to load folder: ${err.message}`);
            console.error(err);
            setBrowserFiles([]);
        } finally {
            setIsLoading(false);
        }
    }, [selectedDeviceId]);

    useEffect(() => {
        if (selectedDeviceId) {
            loadDirectoryContents('/sdcard/');
            setCurrentBrowserPath('/sdcard/');
        } else {
            setBrowserFiles([]);
            setCurrentBrowserPath('/sdcard/');
            if (devices.length > 0) setStatus('Please select a device.');
        }
    }, [selectedDeviceId, loadDirectoryContents]);

    const handleDeviceChange = (event) => {
        setSelectedDeviceId(event.target.value);
    };

    const handleViewFilesClick = () => {
        if (selectedDeviceId) {
            loadDirectoryContents(currentBrowserPath);
        } else {
            setStatus('Please select a device first.');
        }
    };

    const handleSelectFile = async (file) => {
        const filePath = file.key;
        const isDirectory = filePath.endsWith('/');

        if (!isDirectory) {
            const fileName = filePath.split('/').pop() || '';
            const lowerName = fileName.toLowerCase();

            let detectedContentType = null;
            if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || lowerName.endsWith('.png') || lowerName.endsWith('.gif') || lowerName.endsWith('.bmp') || lowerName.endsWith('.webp')) {
                detectedContentType = 'image';
            } else if (lowerName.endsWith('.mp4') || lowerName.endsWith('.webm') || lowerName.endsWith('.ogg') || lowerName.endsWith('.ogv')) {
                detectedContentType = 'video';
            }

            if (detectedContentType) {
                setModalStatusText('Loading preview...');
                setIsModalOpen(true);
                setModalContentSrc('');
                setPreviewContentType(detectedContentType);
                setCurrentPreviewFile({ deviceId: selectedDeviceId, remotePath: filePath, localTempPath: null }); // Reset localTempPath
                try {
                    const result = await window.api.pullFileForPreview(selectedDeviceId, filePath);
                    if (result.success) {
                        if (detectedContentType === 'video' && result.videoUrl) {
                            // For videos, use the custom protocol URL
                            setModalContentSrc(result.videoUrl);
                            setCurrentPreviewFile(prev => ({ ...prev, localTempPath: result.localTempPathForCleanup })); // Store the actual fs path for cleanup
                        } else if (detectedContentType === 'image' && result.data) {
                            setModalContentSrc(`data:${result.mimeType};base64,${result.data}`);
                        } else {
                            setModalContentSrc('');
                            setModalStatusText(`Error: Preview data missing or type mismatch.`);
                            console.error("Preview Error: Data missing or type mismatch", result);
                        }
                        setModalStatusText('');
                    } else {
                        setModalContentSrc('');
                        setModalStatusText(`Error: ${result.error}`);
                    }
                } catch (error) {
                    setModalContentSrc('');
                    setModalStatusText(`Error: ${error.message}`);
                }
            } else { // File type not recognized for direct preview
                setPreviewContentType(null);
                // Optionally, trigger download for other file types or show a message
                setCurrentPreviewFile({ deviceId: selectedDeviceId, remotePath: filePath, localTempPath: null });
                // handleModalDownload(); // Or just inform the user
                setStatus(`File type "${lowerName.split('.').pop()}" not supported for direct preview. You can download it.`);
            }
        }
    };

    const handleSelectFolder = (folder) => {
        if (folder && folder.key) {
            const targetPath = folder.key;
            setCurrentBrowserPath(targetPath);
            loadDirectoryContents(targetPath);
        } else {
            console.warn("handleSelectFolder called with invalid folder object:", folder);
        }
    };

    const handleModalClose = async () => {
        setIsModalOpen(false);
        
        // Stop video playback using the ref
        if (previewContentType === 'video' && videoRef.current) {
            const videoElement = videoRef.current;
            if (videoElement) {
                videoElement.pause();
                videoElement.removeAttribute('src'); // detach source
                videoElement.load(); // necessary for some browsers to release file lock
            }
        }

        setModalContentSrc(''); // Clear src after potential video operations
        setModalStatusText('');
        setPreviewContentType(null);

        if (currentPreviewFile.localTempPath) {
            try {
                await window.api.cleanupPreviewFile(currentPreviewFile.localTempPath);
            } catch (err) {
                console.error("Error during preview file cleanup request:", err.message);
            }
        }
        setCurrentPreviewFile({ deviceId: null, remotePath: null, localTempPath: null });
    };

    const handleModalDownload = async () => {
        if (!currentPreviewFile.deviceId || !currentPreviewFile.remotePath) {
            setModalStatusText('Error: No file selected for download.');
            return;
        }
        setModalStatusText('Downloading...');
        try {
            // This will always pull fresh from the device, which is fine.
            const result = await window.api.downloadFile(currentPreviewFile.deviceId, currentPreviewFile.remotePath);
            setModalStatusText(result.success ? `Downloaded to: ${result.path}` : `Download failed: ${result.error}`);
        } catch (error) {
            setModalStatusText(`Download failed: ${error.message}`);
        }
    };

    const handleDownloadSelected = async (selectedRows) => {
        if (!selectedDeviceId || selectedRows.length === 0) {
            setStatus('No files selected or no device connected.');
            return;
        }

        const filesToDownload = selectedRows
            .map(row => row.original)
            .filter(file => !file.key.endsWith('/')); // Only download files, not directories

        if (filesToDownload.length === 0) {
            setStatus('No files (non-directories) selected for download.');
            return;
        }

        setIsDownloadingZip(true);
        setStatus(`Preparing to download ${filesToDownload.length} files as ZIP...`);

        try {
            const result = await window.api.downloadSelectedFiles(selectedDeviceId, filesToDownload);
            if (result.success) {
                setStatus(`Successfully downloaded ZIP to: ${result.path}`);
            } else {
                setStatus(`Failed to download ZIP: ${result.error || 'Unknown error'}`);
            }
        } catch (error) {
            setStatus(`Error downloading ZIP: ${error.message}`);
        } finally {
            setIsDownloadingZip(false);
        }
    };

    const handleOpenConfirmBatchDeleteDialog = (selectedRows) => {
        const files = selectedRows
            .map(row => row.original)
            .filter(file => !file.key.endsWith('/')); // Only files

        if (files.length === 0) {
            setStatus('No files (non-directories) selected for batch deletion.');
            return;
        }
        setFilesToDeleteInBatch(files);
        setBatchDeleteStatus('');
        setIsConfirmBatchDeleteDialogOpen(true);
    };

    const handleCloseConfirmBatchDeleteDialog = () => {
        setIsConfirmBatchDeleteDialogOpen(false);
        setFilesToDeleteInBatch([]);
        setBatchDeleteStatus('');
    };

    const handleConfirmBatchDelete = async () => {
        if (filesToDeleteInBatch.length === 0 || !selectedDeviceId) {
            setBatchDeleteStatus('Error: No files selected or device not connected.');
            return;
        }

        setIsLoading(true); // Use main loading indicator
        setBatchDeleteStatus(`Deleting ${filesToDeleteInBatch.length} files...`);

        let successCount = 0;
        let errorCount = 0;
        const errorMessages = [];

        for (const file of filesToDeleteInBatch) {
            try {
                const result = await window.api.removeFile(selectedDeviceId, file.key);
                if (result.success) {
                    successCount++;
                } else {
                    errorCount++;
                    errorMessages.push(`Failed to delete ${file.name}: ${result.error || 'Unknown error'}`);
                }
            } catch (error) {
                errorCount++;
                errorMessages.push(`Error deleting ${file.name}: ${error.message}`);
            }
        }

        const finalStatus = `${successCount} file(s) deleted successfully. ${errorCount} file(s) failed.`;
        setStatus(finalStatus + (errorMessages.length > 0 ? ` Errors: ${errorMessages.join('; ')}` : ''));
        setBatchDeleteStatus(finalStatus + (errorMessages.length > 0 ? `\nDetails:\n${errorMessages.slice(0,3).join('\n')}${errorMessages.length > 3 ? '\n...and more.' : ''}` : ''));

        await loadDirectoryContents(currentBrowserPath); // Refresh directory
        table.resetRowSelection(); // Clear selection after batch delete
        // Do not close dialog immediately if there were errors, so user can see them.
        // handleCloseConfirmBatchDeleteDialog(); // Or close it after a delay, or based on errors.
        setIsLoading(false);
    };

    const handleOpenConfirmDeleteDialog = (file) => {
        if (file.key.endsWith('/')) {
            // This case should ideally be prevented by disabling the button for directories
            setStatus('Directory deletion is not directly supported via this action.');
            return;
        }
        setFileToDelete(file);
        setDeleteStatus(''); // Clear previous status
        setIsConfirmDeleteDialogOpen(true);
    };

    const handleCloseConfirmDeleteDialog = () => {
        setIsConfirmDeleteDialogOpen(false);
        setFileToDelete(null);
        setDeleteStatus('');
    };

    const handleConfirmDelete = async () => {
        if (!fileToDelete || !selectedDeviceId) {
            setDeleteStatus('Error: No file selected or device not connected.');
            return;
        }
        setDeleteStatus(`Deleting ${fileToDelete.name}...`);
        setIsLoading(true); // Use main loading indicator for the table

        try {
            const result = await window.api.removeFile(selectedDeviceId, fileToDelete.key);
            if (result.success) {
                setStatus(`Successfully deleted ${fileToDelete.name}.`);
                await loadDirectoryContents(currentBrowserPath); // Refresh directory
                handleCloseConfirmDeleteDialog();
            } else {
                setDeleteStatus(`Failed to delete ${fileToDelete.name}: ${result.error || 'Unknown error'}`);
                setStatus(`Failed to delete ${fileToDelete.name}: ${result.error || 'Unknown error'}`);
            }
        } catch (error) {
            setDeleteStatus(`Error deleting ${fileToDelete.name}: ${error.message}`);
            setStatus(`Error deleting ${fileToDelete.name}: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const columns = React.useMemo(
        () => [
            {
                accessorKey: 'name',
                header: 'Name',
                size: 250,
                Cell: ({ row }) => (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {row.original.key.endsWith('/') ? <FolderIcon /> : <DescriptionIcon />}
                        {row.original.name}
                    </Box>
                ),
            },
            {
                accessorKey: 'size',
                header: 'Size',
                size: 120,
                Cell: ({ cell, row }) => row.original.key.endsWith('/') ? '' : formatBytes(cell.getValue()),
                muiTableHeadCellProps: { align: 'right' },
                muiTableBodyCellProps: { align: 'right' },
            },
            {
                accessorKey: 'modified',
                header: 'Date Modified',
                size: 200,
                filterVariant: 'date-range',
                Cell: ({ cell }) => cell.getValue() ? new Date(cell.getValue()).toLocaleString() : '',
                muiTableHeadCellProps: { align: 'right' },
                muiTableBodyCellProps: { align: 'right' },
            },
        ],
        []
    );

    const table = useMaterialReactTable({
        columns,
        data: browserFiles,
        enableColumnActions: true,
        enableColumnFilters: true,
        enablePagination: true,
        enableSorting: true,
        enableDensityToggle: false,
        enableRowSelection: true, // Enable row selection
        enableFullScreenToggle: false,
        enableHiding: false,
        enableRowActions: true,
        positionActionsColumn: 'last',
        renderRowActions: ({ row }) => (
            <Box sx={{ display: 'flex', gap: '0.5rem' }}>
                <Tooltip title="Delete File">
                    <span> {/* Span for Tooltip when IconButton is disabled */}
                        <IconButton
                            color="error"
                            onClick={(e) => {
                                e.stopPropagation(); // Prevent row click from firing
                                handleOpenConfirmDeleteDialog(row.original);
                            }}
                            disabled={isLoading || row.original.key.endsWith('/')} // Disable for directories or when loading
                        >
                            <DeleteIcon />
                        </IconButton>
                    </span>
                </Tooltip>
            </Box>
        ),
        muiTableBodyRowProps: ({ row }) => ({
            onClick: () => !isLoading && (row.original.key.endsWith('/') ? handleSelectFolder(row.original) : handleSelectFile(row.original)),
            sx: { cursor: isLoading ? 'default' : 'pointer' }
        }),
        state: { isLoading: isLoading || isDownloadingZip, showProgressBars: isLoading || isDownloadingZip },
        initialState: { density: 'compact', pagination: { pageSize: 25, pageIndex: 0 } },
    });

    const selectedFilesForActions = table.getSelectedRowModel().flatRows.filter(
        r => r.original && r.original.key && !r.original.key.endsWith('/')
    );


    return (
        <Box sx={{ p: 3, height: '100vh', display: 'flex', flexDirection: 'column' }}>
            {/* Header and Device Selector */}
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2 }}>
                <FormControl fullWidth disabled={devices.length === 0 || isLoading} size="small">
                    <InputLabel id="device-select-label">Device</InputLabel>
                    <Select
                        labelId="device-select-label"
                        id="device-select"
                        value={selectedDeviceId}
                        label="Device"
                        onChange={handleDeviceChange}
                    >
                        <MenuItem value="">
                            <em>{devices.length > 0 ? "Select a device" : "No devices found"}</em>
                        </MenuItem>
                        {devices.map(d => <MenuItem key={d} value={d}>{d}</MenuItem>)}
                    </Select>
                </FormControl>
                <Button
                    variant="outlined"
                    onClick={handleViewFilesClick}
                    disabled={!selectedDeviceId || isLoading}
                    startIcon={isLoading ? <CircularProgress size={20} /> : <RefreshIcon />}
                >
                    {isLoading ? 'Loading...' : 'Refresh'}
                </Button>
                {selectedFilesForActions.length > 0 && (
                    <>
                        <Button
                            variant="contained"
                            color="primary"
                            onClick={() => handleDownloadSelected(table.getSelectedRowModel().flatRows)}
                            disabled={isDownloadingZip || isLoading}
                            startIcon={isDownloadingZip ? <CircularProgress size={20} color="inherit" /> : null}
                        >
                            {isDownloadingZip
                                ? `Downloading ${selectedFilesForActions.length} Files...`
                                : `Download ${selectedFilesForActions.length} Selected`}
                        </Button>
                        <Button
                            variant="outlined"
                            color="error"
                            onClick={() => handleOpenConfirmBatchDeleteDialog(table.getSelectedRowModel().flatRows)}
                            disabled={isLoading || isDownloadingZip}
                            startIcon={isLoading && batchDeleteStatus.includes('Deleting') ? <CircularProgress size={20} color="inherit" /> : <DeleteIcon />}
                        >
                            {isLoading && batchDeleteStatus.includes('Deleting')
                                ? `Deleting ${filesToDeleteInBatch.length > 0 ? filesToDeleteInBatch.length : selectedFilesForActions.length} Files...`
                                : `Remove ${selectedFilesForActions.length} Selected`
                            }
                        </Button>
                    </>
                )}
            </Box>
            <Typography variant="caption" display="block" gutterBottom sx={{ minHeight: '20px'}}>
                {status}
            </Typography>

            {/* Folder View */}
            {selectedDeviceId && (
                <Paper elevation={2} sx={{ flexGrow: 1, overflowY: 'auto', p: 1.5, display: 'flex', flexDirection: 'column' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography variant="body2" sx={{ml:1}}>Current Path: {currentBrowserPath}</Typography>
                        {currentBrowserPath !== '/' && getParentPath(currentBrowserPath) && (
                            <Tooltip title={`Go up to ${getParentPath(currentBrowserPath)}`}>
                                <IconButton
                                    onClick={() => !isLoading && handleSelectFolder({ key: getParentPath(currentBrowserPath) })}
                                    disabled={isLoading}
                                    size="small"
                                >
                                    <ArrowUpwardIcon />
                                </IconButton>
                            </Tooltip>
                        )}
                    </Box>
                    <Box sx={{ flexGrow: 1, overflow: 'auto' }}> {/* Ensure table itself can scroll if needed */}
                        <MaterialReactTable table={table} />
                    </Box>
                    {/* Loading/empty state is handled by MaterialReactTable's state.showProgressBars and noResultsOverlay */}
                </Paper>
            )}

            {/* Modal for Image Preview */}
            {isModalOpen && (
                <Dialog
                    open={isModalOpen}
                    onClose={handleModalClose}
                    aria-labelledby="image-preview-dialog-title"
                    maxWidth="xl"
                >
                    <DialogTitle id="image-preview-dialog-title">
                        {previewContentType === 'image' ? 'Image Preview' : (previewContentType === 'video' ? 'Video Preview' : 'File Preview')}
                    </DialogTitle>
                    <DialogContent>
                        {modalContentSrc && previewContentType === 'image' ? (
                            <img src={modalContentSrc} alt="Preview" style={{ maxWidth: '100%', maxHeight: '90vh', display: 'block', margin: '0 auto' }}/>
                        ) : modalContentSrc && previewContentType === 'video' ? (
                            <video
                                controls
                                ref={videoRef} // Assign the ref here
                                autoPlay // Optional: attempt to autoplay if browser policies allow
                                src={modalContentSrc}
                                style={{ maxWidth: '100%', maxHeight: '100vh', display: 'block', margin: '0 auto' }}
                            >
                                Your browser does not support the video tag.
                            </video>
                        ) : (
                            <Box sx={{ textAlign: 'center', p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}><CircularProgress /> <Typography>Loading content...</Typography></Box>
                        )}
                        {modalStatusText && <DialogContentText sx={{ textAlign: 'center', mt: 2 }}>{modalStatusText}</DialogContentText>}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={handleModalDownload} variant="contained" disabled={!modalContentSrc && !currentPreviewFile.remotePath /* Allow download if preview failed but file is known */}>Download</Button>
                        <Button onClick={handleModalClose}>Close</Button>
                    </DialogActions>
                </Dialog>
            )}

            {/* Confirmation Dialog for Deletion */}
            {isConfirmDeleteDialogOpen && fileToDelete && (
                <Dialog
                    open={isConfirmDeleteDialogOpen}
                    onClose={handleCloseConfirmDeleteDialog}
                    aria-labelledby="confirm-delete-dialog-title"
                >
                    <DialogTitle id="confirm-delete-dialog-title">Confirm Deletion</DialogTitle>
                    <DialogContent>
                        <DialogContentText>
                            Are you sure you want to delete "{fileToDelete.name}" from the device? This action cannot be undone.
                        </DialogContentText>
                        {deleteStatus && (
                            <DialogContentText color={deleteStatus.startsWith('Error') || deleteStatus.startsWith('Failed') ? "error" : "inherit"} sx={{ mt: 2, wordBreak: 'break-word' }}>
                                {deleteStatus}
                            </DialogContentText>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={handleCloseConfirmDeleteDialog} disabled={isLoading}>Cancel</Button>
                        <Button onClick={handleConfirmDelete} color="error" variant="contained" disabled={isLoading}>
                            {isLoading && fileToDelete ? <CircularProgress size={20} color="inherit" sx={{mr: 1}} /> : null}Delete</Button>
                    </DialogActions>
                </Dialog>
            )}

            {/* Confirmation Dialog for Batch Deletion */}
            {isConfirmBatchDeleteDialogOpen && filesToDeleteInBatch.length > 0 && (
                <Dialog
                    open={isConfirmBatchDeleteDialogOpen}
                    onClose={handleCloseConfirmBatchDeleteDialog}
                    aria-labelledby="confirm-batch-delete-dialog-title"
                >
                    <DialogTitle id="confirm-batch-delete-dialog-title">Confirm Batch Deletion</DialogTitle>
                    <DialogContent>
                        <DialogContentText>
                            Are you sure you want to delete {filesToDeleteInBatch.length} selected file(s) from the device?
                            This action cannot be undone.
                        </DialogContentText>
                        <DialogContentText sx={{ mt:1, fontSize: '0.9em', maxHeight: '100px', overflowY: 'auto' }}>
                            {filesToDeleteInBatch.slice(0, 5).map(f => f.name).join(', ')}
                            {filesToDeleteInBatch.length > 5 ? ` and ${filesToDeleteInBatch.length - 5} more...` : ''}
                        </DialogContentText>
                        {batchDeleteStatus && (
                            <DialogContentText color={batchDeleteStatus.includes('Error') || batchDeleteStatus.includes('Failed') || batchDeleteStatus.includes('failed') ? "error" : "inherit"} sx={{ mt: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                {batchDeleteStatus}
                            </DialogContentText>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={handleCloseConfirmBatchDeleteDialog} disabled={isLoading}>Cancel</Button>
                        <Button onClick={handleConfirmBatchDelete} color="error" variant="contained" disabled={isLoading || batchDeleteStatus.includes('Deleting')}>
                            {isLoading && batchDeleteStatus.includes('Deleting') ? <CircularProgress size={20} color="inherit" sx={{mr: 1}} /> : null}Delete Selected</Button>
                    </DialogActions>
                </Dialog>
            )}
        </Box>
    );
};

// Wrap App with LocalizationProvider for date pickers/utils used by MaterialReactTable
const container = document.getElementById('root');
const root = createRoot(container);
root.render(
    <LocalizationProvider dateAdapter={AdapterDateFns}>
        <App />
    </LocalizationProvider>
);
