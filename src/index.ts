import Plugin from '@jbrowse/core/Plugin'
import PluginManager from '@jbrowse/core/PluginManager'
import { addDisposer, getSnapshot, types } from 'mobx-state-tree'
import { version } from '../package.json'
import {
  AnyConfigurationSchemaType,
  ConfigurationReference,
  ConfigurationSchema,
  getConf,
} from '@jbrowse/core/configuration'
import { DisplayType } from '@jbrowse/core/pluggableElementTypes'
import { autorun } from 'mobx'
import {
  Feature,
  getContainingView,
  getEnv,
  getSession,
} from '@jbrowse/core/util'
import { getRpcSessionId } from '@jbrowse/core/util/tracks'
import { LinearGenomeViewModel } from '@jbrowse/plugin-linear-genome-view'
import { getPalette } from './palette'

function configSchemaF(pluginManager: PluginManager) {
  const { configSchema } = pluginManager.getDisplayType('LinearBasicDisplay')
  return ConfigurationSchema(
    'ColorizeDisplay',
    {},
    {
      baseConfiguration: configSchema,
    },
  )
}

function stateModelF(
  pluginManager: PluginManager,
  configSchema: AnyConfigurationSchemaType,
) {
  const { stateModel } = pluginManager.getDisplayType('LinearBasicDisplay')
  return types
    .compose(
      stateModel as any,
      types.model('ColorizeDisplay', {
        type: 'ColorizeDisplay',
        configuration: ConfigurationReference(configSchema),
      }),
    )
    .volatile(() => ({
      feats: undefined as Feature[] | undefined,
    }))
    .actions(self => ({
      setFeats(f: any) {
        self.feats = f
      },
    }))
    .actions(self => ({
      afterAttach() {
        addDisposer(
          self,
          autorun(async () => {
            try {
              const view = getContainingView(self) as LinearGenomeViewModel
              if (!view.initialized) {
                return
              }
              const { rpcManager } = getSession(self)
              const track = view.tracks[0]
              const adapterConfig = getConf(track, 'adapter')
              const sessionId = getRpcSessionId(track)
              const feats = await rpcManager.call(
                sessionId,
                'CoreGetFeatures',
                {
                  adapterConfig,
                  sessionId,
                  regions: view.staticBlocks.contentBlocks,
                },
              )
              self.setFeats(feats)
            } catch (e) {
              console.error(e)
              self.setError(e)
            }
          }),
        )
      },
    }))
    .views(self => ({
      get rendererConfig2() {
        const s = [...new Set(self.feats?.map(f => f.get('name')) || [])]
        const palette = getPalette(s.length)
        let genJexl = ''
        for (let i = 0; i < s.length; i++) {
          genJexl += `get(feature,'name')=='${s[i]}'?'${palette[i % palette.length]}':`
        }
        genJexl += 'black'

        return self.rendererType.configSchema.create(
          {
            ...getSnapshot(self.rendererConfig),
            color1: `jexl:${genJexl}`,
          },
          getEnv(self),
        )
      },
    }))
    .views(self => {
      const superRenderProps = self.renderProps
      return {
        renderProps() {
          const superProps = superRenderProps()
          return {
            ...superProps,
            notReady: superProps.notReady || !self.feats,
            config: self.rendererConfig2,
          }
        },
      }
    })
}

export default class ColorizePlugin extends Plugin {
  name = 'ColorizePlugin'
  version = version

  install(pluginManager: PluginManager) {
    pluginManager.addDisplayType(() => {
      const { ReactComponent } =
        pluginManager.getDisplayType('LinearBasicDisplay')
      const configSchema = configSchemaF(pluginManager)
      return new DisplayType({
        name: 'ColorizeDisplay',
        trackType: 'FeatureTrack',
        viewType: 'LinearGenomeView',
        configSchema,
        stateModel: stateModelF(pluginManager, configSchema),
        ReactComponent,
      })
    })
  }

  configure(pluginManager: PluginManager) {}
}
