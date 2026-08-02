# Plan de Proyecto — Juego 3D (nombre a definir)

## 1. Concepto
Mini-aventura 3D en tercera persona: el jugador explora un entorno pequeño (una isla o
un valle), recolecta objetos, esquiva/supera un obstáculo u enemigo simple, y llega a una
meta. Alcance intencionalmente chico para completarlo de punta a punta, pero con una
arquitectura que escala si después se quiere seguir agregando contenido.

**Por qué este alcance:** un juego 3D completo (assets, mecánicas, pulido) es un proyecto
de meses. Empezar con un "vertical slice" (una porción jugable completa) es la práctica
profesional estándar: valida el flujo de herramientas y la arquitectura antes de invertir
en contenido.

## 2. Herramientas (stack)
| Herramienta | Uso |
|---|---|
| **Unity Hub + Unity Editor (LTS)** | Motor del juego, escenas, lógica, build |
| **Blender** | Modelado 3D de props/personaje, animación básica |
| **GIMP** | Texturas, UI, retoque de imágenes |
| **Krita** | Concept art, pintado de texturas, sprites 2D si hacen falta |
| **Audacity** | Edición de efectos de sonido y música |
| **Git + Git LFS** | Control de versiones (LFS para binarios: modelos, texturas, audio) |
| **Visual Studio / VS Code** | Edición de C# (scripts de Unity) |

## 3. Estructura de carpetas del proyecto Unity
Cuando se cree el proyecto en Unity Hub, usar esta convención dentro de `Assets/`:

```
Assets/
  _Project/
    Scripts/
      Player/
      Enemies/
      Systems/       (game manager, save, audio manager, etc.)
      UI/
    Prefabs/
    Scenes/
      00_MainMenu
      01_Level01
    Materials/
    Art/
      Models/        (.blend o .fbx exportados de Blender)
      Textures/
      Animations/
    Audio/
      SFX/
      Music/
    Data/            (ScriptableObjects: stats, items, config)
```

Convención: `_Project` va primero (el guion bajo lo ordena arriba) para separar
claramente el contenido propio de assets de terceros/plugins.

## 4. Arquitectura de código (buenas prácticas desde el día 1)
- **Input System** (paquete oficial de Unity) en vez de `Input.GetKey` viejo — más
  profesional, soporta rebinding y múltiples dispositivos.
- **ScriptableObjects** para datos (items, stats, configuración) en vez de hardcodear
  valores — permite editar sin tocar código y facilita testing.
- **Un GameManager único** (patrón singleton simple) para estado global (puntaje, nivel
  actual), evitar dependencias circulares entre scripts.
- **Assembly Definitions** (`.asmdef`) separando `Player`, `Systems`, `UI` — mejora
  tiempos de compilación y fuerza límites claros entre módulos.
- **Naming consistente**: `PascalCase` para clases/métodos públicos, `_camelCase` para
  campos privados serializados.

## 5. Pipeline Blender → Unity
1. Modelar en Blender con **escala real** (1 unidad Blender = 1 metro) para que
   coincida con Unity sin reescalar todo después.
2. Aplicar transformaciones (`Ctrl+A` → All Transforms) antes de exportar — evita
   rotaciones/escalas inesperadas al importar.
3. Guardar el `.blend` directamente dentro de `Assets/_Project/Art/Models/` — Unity
   importa archivos `.blend` de forma nativa (usa Blender instalado en el sistema).
4. Nombrar los objetos y materiales en Blender igual a como se van a usar en Unity —
   ahorra renombrar después.

## 6. Milestones
1. **Prototipo gris (semana 1-2):** movimiento del personaje, cámara, un nivel de
   bloques simples (cubos/planos), mecánica core jugable de principio a fin sin arte
   final. Objetivo: que el juego sea "divertido" antes de invertir en arte.
2. **Primer pase de arte (semana 3-4):** reemplazar bloques grises por modelos de
   Blender, texturas de GIMP/Krita, iluminación básica.
3. **Sonido y UI (semana 5):** SFX editados en Audacity, música, menú principal, HUD.
4. **Pulido ("juice") (semana 6):** partículas simples, animaciones de cámara, feedback
   visual/sonoro de acciones, ajuste de dificultad.
5. **Build y playtest (semana 7):** compilar build de Windows, probar con alguien más,
   ajustar según feedback.

Los tiempos son orientativos — el objetivo es tener siempre algo jugable, no seguir el
cronograma al pie de la letra.

## 7. Control de versiones
- Repo Git separado de `CasaDeLasTortas` (proyecto distinto).
- `.gitignore` específico de Unity (carpetas `Library/`, `Temp/`, `Obj/`, `Build/` no se
  versionan — se regeneran solas).
- Considerar **Git LFS** para modelos/texturas/audio si el repo empieza a pesar mucho
  (los binarios de Unity crecen rápido).

## 8. Próximos pasos manuales (requieren tu intervención)
Estos pasos no se pueden automatizar porque requieren login/decisiones tuyas:
1. Abrir **Unity Hub** → crear cuenta Unity (gratuita) → instalar una versión de
   **Unity Editor LTS** desde la pestaña "Installs" (incluir módulo "Microsoft Visual
   Studio Community" si no tenés VS, o saltearlo si ya lo tenés).
2. En Unity Hub → "Projects" → "New Project" → template **3D (Core)** → ubicarlo en
   esta misma carpeta (`ProyectoJuego3D`).
3. Avisame cuando esté creado y seguimos con el prototipo (movimiento del personaje).
