      // 地域手当の割合を data/rules.js の表から引く関数（RULES.regionalRate / RULES.regionalAreaList）
      // 地域手当の割合（％）：都道府県・地域（市町村名。"" は「その他の地域」）・年度（4月〜翌3月）から決める。
      // 経過措置の期間は附則別表第一（表にない地域は0％）、それ以後は本則。空港の区域（規則9-49第4条）は経過措置の対象外
      window.RULES.regionalRate = (pref, area, fy) => {
        const A = window.RULES.allowances,
          base = A.regionalAreas[pref];
        if (!base) return 0;
        const honsoku = (base.cities || []).find(([n]) => n === area)?.[1] ?? base.rate,
          T = A.regionalTransition;
        if (/空港の区域$/.test(area) || fy > T.untilFy) return honsoku;
        const years = Object.keys(T.byFy).map(Number).sort((a, b) => a - b),
          y = years.filter((v) => v <= fy).at(-1) ?? years[0],
          row = (T.byFy[y][pref] || []).find(([, names]) => names.split(" ").includes(area));
        return row ? row[0] : 0;
      };
      // 都道府県ごとに選べる地域の一覧（本則の市と、経過措置の表に載っている市町村をまとめる）
      window.RULES.regionalAreaList = (pref) => {
        const A = window.RULES.allowances,
          names = (A.regionalAreas[pref]?.cities || []).map(([n]) => n);
        for (const y of Object.keys(A.regionalTransition.byFy))
          for (const [, list] of A.regionalTransition.byFy[y][pref] || [])
            for (const n of list.split(" ")) if (!names.includes(n)) names.push(n);
        return names;
      };
