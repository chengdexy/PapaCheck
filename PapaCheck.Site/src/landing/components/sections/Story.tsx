const steps = [
  {
    time: '17:30',
    title: '孩子放学回家',
    body: '打开 PapaCheck 看到今天的作业清单。每一项有清晰的完成度 + 期待奖励，孩子心里有数。',
    mascot: '/imgs/mascot/mascot-point.png',
    mascotAlt: 'PapaCheck 吉祥物指向作业清单',
  },
  {
    time: '19:00',
    title: '家长在手机上随手检查',
    body: '孩子做完一项，爸妈在手机上收到推送。一键评优，积分自动到账。不用守在旁边。',
    mascot: '/imgs/mascot/mascot-ok.png',
    mascotAlt: 'PapaCheck 吉祥物竖起大拇指',
  },
  {
    time: '20:00',
    title: '孩子主动收尾',
    body: '为了兑换想要的玩具/游戏时间，孩子主动把作业收尾。爸妈不催不喊，关系更轻松。',
    mascot: '/imgs/mascot/mascot-thumbs.png',
    mascotAlt: 'PapaCheck 吉祥物点赞',
  },
];

export default function Story() {
  return (
    <section id="story" className="py-20 md:py-28 bg-white">
      <div className="hero-container">
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-4 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-xs font-semibold tracking-wide">
            真实使用场景
          </div>
          <h2 className="text-4xl md:text-5xl font-extrabold text-ink-900 tracking-tight">
            一个<span className="hl-stroke">普通的晚上</span>
          </h2>
          <p className="mt-4 text-lg text-ink-600 max-w-2xl mx-auto">
            看 PapaCheck 如何把"催作业"变成全家的小确幸
          </p>
        </div>

        <div className="relative">
          {/* 时间线竖线（桌面端） */}
          <div className="hidden md:block absolute left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-brand-200 to-transparent -translate-x-1/2" />

          <div className="space-y-12 md:space-y-16">
            {steps.map((step, i) => {
              const isLeft = i % 2 === 0;
              return (
                <div
                  key={i}
                  className={`relative grid grid-cols-1 md:grid-cols-2 gap-6 items-center ${
                    isLeft ? '' : 'md:[direction:rtl]'
                  }`}
                >
                  <div className={`${isLeft ? 'md:pr-12 md:text-right' : 'md:pl-12'} md:[direction:ltr]`}>
                    <div className={`inline-flex items-center gap-2 mb-3 px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 text-xs font-bold ${isLeft ? 'md:ml-auto' : ''}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
                      {step.time}
                    </div>
                    <h3 className="text-2xl md:text-3xl font-bold text-ink-900 leading-tight">
                      {step.title}
                    </h3>
                    <p className="mt-3 text-ink-600 leading-relaxed">
                      {step.body}
                    </p>
                  </div>

                  <div className={`hidden md:flex ${isLeft ? 'md:justify-start md:pl-12' : 'md:justify-end md:pr-12'} md:[direction:ltr]`}>
                    <img
                      src={step.mascot}
                      alt={step.mascotAlt}
                      className="relative z-10 w-48 h-48 object-contain drop-shadow-[0_10px_20px_rgba(249,115,22,0.15)] mascot-float-slow"
                    />
                  </div>

                  {/* 时间线节点 */}
                  <div className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white border-4 border-brand-500 shadow-sm z-10" />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
