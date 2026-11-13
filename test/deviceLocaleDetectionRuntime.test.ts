import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import {
  frStrings,
  getLocaleStrings,
  resolveLocale,
  resetDeviceLocaleCache,
  setDeviceLocaleProvider,
} from '../src/i18n';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEVICE_LOCALE_SOURCE = readFileSync(path.join(ROOT, 'src/i18n/deviceLocale.ts'), 'utf8');

type DeviceLocaleModule = {
  getDeviceLocale: () => string | null;
  resetDeviceLocaleCache: () => void;
  setDeviceLocaleProvider: (detector: (() => string | null) | null) => void;
};

function loadDeviceLocaleInVm(requireImpl: (id: string) => unknown): DeviceLocaleModule {
  const { outputText } = ts.transpileModule(DEVICE_LOCALE_SOURCE, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });

  const sandbox: Record<string, unknown> = {
    module: { exports: {} as DeviceLocaleModule },
    exports: {},
    require: requireImpl,
  };
  sandbox.exports = (sandbox.module as { exports: unknown }).exports;
  vm.runInNewContext(outputText, sandbox);
  return (sandbox.module as { exports: DeviceLocaleModule }).exports;
}

test('getDeviceLocale reads mocked expo-localization getLocales through runtime require (#443)', () => {
  const mod = loadDeviceLocaleInVm((id) => {
    if (id === 'expo-localization') {
      return {
        getLocales: () => [{ languageTag: 'fr-FR' }],
        locale: 'de-DE',
      };
    }
    if (id === 'react-native-localize') {
      return { getLocales: () => [{ languageTag: 'de-DE' }] };
    }
    if (id === 'react-native') {
      throw new Error('react-native unavailable in vm test');
    }
    throw new Error(`unexpected require: ${id}`);
  });

  mod.setDeviceLocaleProvider(null);
  mod.resetDeviceLocaleCache();
  assert.equal(mod.getDeviceLocale(), 'fr-FR');
  setDeviceLocaleProvider(() => mod.getDeviceLocale());
  assert.equal(resolveLocale('auto'), 'fr-FR');
  const detected = resolveLocale('auto');
  assert.equal(getLocaleStrings(detected).feedbackComposer.title, frStrings.feedbackComposer.title);
  setDeviceLocaleProvider(null);
  resetDeviceLocaleCache();
});

test('getDeviceLocale reads mocked expo-localization v10 locale export through runtime require (#443)', () => {
  const mod = loadDeviceLocaleInVm((id) => {
    if (id === 'expo-localization') {
      return { locale: 'pt-BR' };
    }
    if (id === 'react-native-localize') {
      return { getLocales: () => [{ languageTag: 'de-DE' }] };
    }
    if (id === 'react-native') {
      throw new Error('react-native unavailable in vm test');
    }
    throw new Error(`unexpected require: ${id}`);
  });

  mod.setDeviceLocaleProvider(null);
  mod.resetDeviceLocaleCache();

  assert.equal(mod.getDeviceLocale(), 'pt-BR');
  setDeviceLocaleProvider(() => mod.getDeviceLocale());
  assert.equal(resolveLocale('auto'), 'pt-BR');
  setDeviceLocaleProvider(null);
  resetDeviceLocaleCache();
});
