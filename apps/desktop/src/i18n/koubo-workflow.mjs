/**
 * Words the desktop talking-head (口播) workflow shows from the main process (the video
 * picker defaults, ingest progress, and errors), in each of Studio's languages.
 * The page has its own copy in the Studio dictionaries (`koubo.*`).
 */
export const KOUBO_WORKFLOW_WORDS = {
  en: {
    pickVideo: 'Choose a talking-head video',
    choose: 'Choose',
    done: 'The talking-head project is open. You can keep adjusting it on the timeline or in the chat on the left.',
    noProjectDir: 'Could not create a new project folder.',
    noLibrary: 'Could not determine the projects library folder.',
    noVideo: 'Please choose a talking-head video first.',
    videoMissing: 'The chosen video could not be found.',
    noTemplate: 'Please choose the template to switch to.',
    networkFailed: 'The request could not be completed (network error). Check the connection and try again.',
    openProjectFailed: 'The project was created, but opening it in the editor failed. Open it from the project list.',
  },
  'zh-CN': {
    pickVideo: '选择口播视频',
    choose: '选择',
    done: '口播工程已打开，可以在时间线或左侧对话里继续调整。',
    noProjectDir: '无法创建新的工程目录。',
    noLibrary: '无法确定项目库目录。',
    noVideo: '请先选择口播视频。',
    videoMissing: '找不到所选视频。',
    noTemplate: '请选择要更换的模板。',
    networkFailed: '网络请求失败，请检查网络连接后重试。',
    openProjectFailed: '工程已创建，但打开编辑器失败。请从项目列表中打开。',
  },
  ja: {
    pickVideo: 'トーク動画を選択',
    choose: '選択',
    done: 'トーク動画のプロジェクトを開きました。タイムラインか左のチャットで続けて調整できます。',
    noProjectDir: '新しいプロジェクトフォルダーを作成できません。',
    noLibrary: 'プロジェクトライブラリの場所が分かりません。',
    noVideo: '先にトーク動画を選んでください。',
    videoMissing: '選んだ動画が見つかりません。',
    noTemplate: '切り替えるテンプレートを選んでください。',
    networkFailed: 'ネットワークエラーのためリクエストを完了できません。接続を確認して再試行してください。',
    openProjectFailed: 'プロジェクトは作成されましたが、エディターで開けませんでした。プロジェクト一覧から開いてください。',
  },
  ko: {
    pickVideo: '토킹헤드 영상 선택',
    choose: '선택',
    done: '토킹헤드 프로젝트가 열렸습니다. 타임라인이나 왼쪽 채팅에서 계속 조정할 수 있습니다.',
    noProjectDir: '새 프로젝트 폴더를 만들 수 없습니다.',
    noLibrary: '프로젝트 라이브러리 위치를 확인할 수 없습니다.',
    noVideo: '먼저 토킹헤드 영상을 선택하세요.',
    videoMissing: '선택한 영상을 찾을 수 없습니다.',
    noTemplate: '바꿀 템플릿을 선택하세요.',
    networkFailed: '네트워크 오류로 요청을 완료할 수 없습니다. 연결을 확인한 뒤 다시 시도하세요.',
    openProjectFailed: '프로젝트는 만들어졌지만 편집기에서 열지 못했습니다. 프로젝트 목록에서 여세요.',
  },
  es: {
    pickVideo: 'Elegir un vídeo hablado',
    choose: 'Elegir',
    done: 'El proyecto de vídeo hablado está abierto. Puedes seguir ajustándolo en la línea de tiempo o en el chat de la izquierda.',
    noProjectDir: 'No se pudo crear una carpeta de proyecto nueva.',
    noLibrary: 'No se pudo determinar la carpeta de la biblioteca de proyectos.',
    noVideo: 'Elige primero un vídeo hablado.',
    videoMissing: 'No se encontró el vídeo elegido.',
    noTemplate: 'Elige la plantilla a la que quieres cambiar.',
    networkFailed: 'No se pudo completar la solicitud (error de red). Comprueba la conexión e inténtalo de nuevo.',
    openProjectFailed: 'El proyecto se creó, pero no se pudo abrir en el editor. Ábrelo desde la lista de proyectos.',
  },
};

/**
 * @param {string | null | undefined} language
 * @returns {typeof KOUBO_WORKFLOW_WORDS['en']}
 */
export function kouboWorkflowWords(language) {
  return KOUBO_WORKFLOW_WORDS[language] ?? KOUBO_WORKFLOW_WORDS.en;
}
