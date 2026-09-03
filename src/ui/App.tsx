import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import Stack from '@mui/material/Stack';
import { ChatContainer } from './components/ChatContainer';
import { DocumentList } from './components/DocumentList';
import { DropZone } from './components/DropZone';
import { LlmSettingsPanel } from './components/LlmSettingsPanel';
import { ModelGate } from './components/ModelGate';
import { TopAppBar } from './components/TopAppBar';
import { useColorMode } from './colorMode';
import { composerBlock } from './state/engineGate';
import { deriveLLMState } from './state/llmState';
import { useChat } from './state/useChat';
import { useDocuments } from './state/useDocuments';
import { useModels } from './state/useModels';
import { useSettings } from './state/useSettings';
import { useSystemStats } from './state/useSystemStats';
import { api as defaultApi } from './api';
import type { IpcApi } from '../shared/ipc';

const SIDEBAR_WIDTH = 392;

/**
 * The window: title bar, corpus on the left, conversation on the right.
 *
 * Every controller is created here and handed down, so a screen never owns state
 * it cannot reconstruct. The layout keeps the transcript in the DOM at all times
 * — overlays cover it, nothing replaces it — because a transcript that
 * disappears when an engine state changes is a record you cannot read.
 */
export function App({ api = defaultApi }: { api?: IpcApi } = {}) {
  const models = useModels(api);
  const documents = useDocuments(api);
  const settings = useSettings(api);
  const chat = useChat(api);
  const stats = useSystemStats(api);
  const { mode, toggleMode } = useColorMode();

  const llm = deriveLLMState(models.status, {
    isStreaming: chat.streamingId !== null,
    isIndexing: documents.isIndexing,
  });

  // Retrieval only ever sees documents that are both switched on and embedded
  // with the model currently loaded, so this is what a question can be answered
  // from — not simply how many files are in the list.
  const inScope = documents.documents.filter((d) => d.active && d.status.state === 'ready');
  const blocked = composerBlock(llm, inScope.length);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TopAppBar state={llm} stats={stats} dark={mode === 'dark'} onToggleTheme={toggleMode} />

      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Drawer
          variant="permanent"
          sx={{
            width: SIDEBAR_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: SIDEBAR_WIDTH,
              boxSizing: 'border-box',
              position: 'relative',
              borderRight: '1px solid',
              borderColor: 'divider',
            },
          }}
        >
          <Stack spacing={2} sx={{ p: 2 }}>
            <DropZone onAdd={(paths) => void documents.addPaths(paths)} />
            <DocumentList
              documents={documents.documents}
              progress={documents.progress}
              onSetActive={(id, active) => void documents.setActive(id, active)}
              onRemove={(id) => void documents.remove(id)}
              onReindex={(id) => void documents.reindex(id)}
            />
            {documents.error ? (
              <Box role="alert" sx={{ color: 'error.main' }}>
                {documents.error}
              </Box>
            ) : null}
            <LlmSettingsPanel models={models} settings={settings} busy={documents.isIndexing} />
          </Stack>
        </Drawer>

        <Box
          component="main"
          id="transcript"
          tabIndex={-1}
          sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}
        >
          <ChatContainer
            chat={chat}
            engineReady={llm.isModelLoaded}
            disabledReason={blocked}
            activeDocuments={inScope.length}
          />
        </Box>
      </Box>

      <ModelGate open={llm.phase === 'no-model'} models={models} />
    </Box>
  );
}
