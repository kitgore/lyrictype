<script>
    import { windowStore } from '$lib/services/store.js';
    import { themeColors } from '$lib/services/store.js';

    // Get trash window dimensions for proportional sizing
    $: trashWindowState = $windowStore.windowStates.find(w => w.id === 'trashWindow');
    $: windowWidth = trashWindowState?.dimensions?.width;
    $: windowHeight = trashWindowState?.dimensions?.height;
    
    // Calculate icon dimensions based on trash window size
    $: iconSize = windowHeight * 0.16; // 8% of window height, minimum 40px
    $: iconLabelSize = Math.max(windowHeight * 0.025, 12); // 2.5% of window height, minimum 12px
    
    // Calculate spacing based on window dimensions
    $: fileGap = windowWidth * 0.02; // 4% of window width, minimum 15px
    $: containerPadding = windowHeight * 0.02; // 2% of window height, minimum 8px

    // Sample files for the trash
    const trashFiles = [
        { name: "Password_list.xls", type: "document" },
        { name: "System Folder/", type: "document" },
        { name: "LimeWire.mp3", type: "audio" },
        { name: "Floppy Disk.flac", type: "document" },
        { name: "Trash-Info.rtf", type: "document" }
    ];
</script>

<div class="files-area" style:padding="{containerPadding}px" style="--icon-size: {iconSize}px">
    <div class="bottom-row" style:gap="{fileGap}px" style:padding="{containerPadding}px">
        {#each trashFiles as file}
            <div class="trash-file">
                <div class="file-icon" style:height="{iconSize}px" style:width="{iconSize}px">
                    <!-- Media Typer icon SVG -->
                    <svg viewBox="-4 0 45 46" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="1" y="0.5" width="35" height="39" rx="1.5" fill="{$themeColors.secondary}" stroke="{$themeColors.primary}"/>
                        <rect x="5" y="4.5" width="27" height="20" rx="1.5" fill="{$themeColors.secondary}" stroke="{$themeColors.primary}"/>
                        <rect x="3" y="39.5" width="31" height="6" fill="{$themeColors.secondary}" stroke="{$themeColors.primary}"/>
                        <line x1="18.5" y1="31.5" x2="30.5" y2="31.5" stroke="{$themeColors.primary}"/>
                        <path fill-rule="evenodd" clip-rule="evenodd" d="M7.5 7H8.5V8H7.5V7ZM7.5 10H8.5V11H7.5V10ZM8.5 13H7.5V14H8.5V13ZM7.5 16H8.5V17H7.5V16ZM8.5 19H7.5V20H8.5V19ZM10.5 7H11.5V8H10.5V7ZM11.5 10H10.5V11H11.5V10ZM10.5 13H11.5V14H10.5V13ZM11.5 16H10.5V17H11.5V16ZM10.5 19H11.5V20H10.5V19ZM14.5 7H13.5V8H14.5V7ZM13.5 10H14.5V11H13.5V10ZM14.5 19H13.5V20H14.5V19ZM16.5 7H17.5V8H16.5V7ZM17.5 10H16.5V11H17.5V10ZM19.5 7H20.5V8H19.5V7ZM23.5 7H22.5V8H23.5V7Z" fill="{$themeColors.primary}"/>
                    </svg>
                </div>
                <div class="file-label" style:font-size="{iconLabelSize}px">{file.name}</div>
            </div>
        {/each}
    </div>
</div>

<style>
    .files-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
    }

    .bottom-row {
        display: flex;
        justify-content: flex-start;
        align-items: flex-end;
    }

    .trash-file {
        display: flex;
        flex-direction: column;
        align-items: center;
        cursor: pointer;
    }

    .file-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: calc(var(--icon-size, 40px) * 0.1);
    }

    .file-icon svg {
        width: 100%;
        height: 100%;
    }

    .file-label {
        background-color: var(--secondary-color);
        color: var(--primary-color);
        text-align: center;
        padding: 2px 4px;
        white-space: nowrap;
        font-size: 0.8em;
    }

    .trash-file:hover .file-label {
        background-color: var(--primary-color);
        color: var(--secondary-color);
    }
</style>
