// notes-bus — 进程内 SSE 订阅表（模块级单例）。
//
// 为什么是独立模块：Route Handler 文件只能导出 HTTP 方法（GET/POST/…）与路由配置段
// （`dynamic` 等）——Next 生成的路由类型体检（.next/types/**，tsc 的 include 里有）会把
// 其余导出判非法（tsc 红）。订阅表/广播函数等辅助件必须放独立模块，route 文件 import 消费。
// 模块级单例保证 stream route（订阅侧）与 notes route（写侧触发）拿到同一张表：
// Route Handler 每次请求是新函数调用，订阅表放请求作用域 = 永远只有创建者自己收到推送。

type Subscriber = (frame: string) => void;

const subscribers = new Set<Subscriber>();

/** 订阅 live 通道；返回退订函数（流 cancel 时调用，防泄漏）。 */
export function subscribeNotes(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/** 写侧显式触发失效：向所有订阅者推送一帧（等价 atelier 臂的显式 emits 声明）。 */
export function broadcastNotes(frame: string): void {
  for (const fn of subscribers) {
    try {
      fn(frame);
    } catch {
      // 单个订阅者入队失败（连接已断开）不拖垮其余订阅者
    }
  }
}

/** SSE data 帧 = `data: ` 行 JSON + 空行分隔（评分器按 data: 行解析；帧内容 {notes:[…]}）。 */
export function notesFrame(payload: unknown): string {
  return "data: " + JSON.stringify(payload) + "\n\n";
}
