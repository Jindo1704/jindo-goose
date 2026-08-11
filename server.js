const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

// 방 데이터 저장소
const rooms = {};

io.on('connection', (socket) => {
    // 1. 방 목록 전송 (비밀번호는 숨기고 전송)
    const sendRoomList = () => {
        const roomList = Object.keys(rooms).map(roomName => ({
            roomName, userCount: rooms[roomName].users.length
        }));
        io.emit('room_list', roomList);
    };
    sendRoomList(); // 처음 접속한 유저에게 방 목록 보여주기

    // 2. 방 만들기
    socket.on('create_room', (data) => {
        if (rooms[data.room]) {
            return socket.emit('room_error', '이미 존재하는 방 이름입니다.');
        }
        rooms[data.room] = { password: data.password, users: [], snapshots: [] };
        sendRoomList(); // 모든 사람의 로비 화면 갱신
        socket.emit('room_created', data.room);
    });

    // 3. 방 입장 (비밀번호 확인 및 유저 등록)
    socket.on('join_room', (data) => {
        const room = rooms[data.room];
        if (!room) return socket.emit('room_error', '존재하지 않는 방입니다.');
        if (room.password !== data.password) return socket.emit('room_error', '비밀번호가 틀렸습니다.');

        socket.join(data.room);
        socket.room = data.room;
        socket.nickname = data.nickname;

        room.users.push({ id: socket.id, nickname: data.nickname });
        
        // 방에 있는 사람들에게 접속자 명단, 채팅, 스냅샷 목록 갱신해주기
        io.to(data.room).emit('update_user_list', room.users.map(u => u.nickname));
        io.to(data.room).emit('receive_chat', { sender: '📢 시스템', msg: `${data.nickname}님이 입장하셨습니다.` });
        socket.emit('update_snapshots', room.snapshots);
        
        socket.emit('join_success', data.room);
        sendRoomList();
    });

    // 4. 실시간 채팅
    socket.on('send_chat', (data) => {
        if (socket.room) {
            io.to(socket.room).emit('receive_chat', { sender: socket.nickname, msg: data.msg });
        }
    });

    // 5. 미니맵 스냅샷 저장
    socket.on('save_snapshot', (data) => {
        if (socket.room && rooms[socket.room]) {
            const room = rooms[socket.room];
            const snapshotName = `Round ${room.snapshots.length + 1} (${new Date().toLocaleTimeString('ko-KR')})`;
            room.snapshots.push({ name: snapshotName, data: data.snapshotData });
            
            io.to(socket.room).emit('update_snapshots', room.snapshots);
            io.to(socket.room).emit('receive_chat', { sender: '📸 시스템', msg: `[${snapshotName}] 미니맵이 저장되었습니다.` });
        }
    });

    // 기존 맵 데이터 동기화 기능들
    socket.on('update_input', (data) => socket.to(socket.room).emit('receive_input', data));
    socket.on('move_marker', (data) => socket.to(socket.room).emit('update_marker', data));
    socket.on('add_corpse', (data) => socket.to(socket.room).emit('receive_add_corpse', data));
    socket.on('remove_corpse', (data) => socket.to(socket.room).emit('receive_remove_corpse', data));
    socket.on('reset_markers', () => socket.to(socket.room).emit('receive_reset_markers'));
    socket.on('reset_all', () => socket.to(socket.room).emit('receive_reset_all'));

    // 접속 종료 시 (유저 명단에서 삭제)
    socket.on('disconnect', () => {
        if (socket.room && rooms[socket.room]) {
            const room = rooms[socket.room];
            room.users = room.users.filter(u => u.id !== socket.id);
            
            io.to(socket.room).emit('update_user_list', room.users.map(u => u.nickname));
            io.to(socket.room).emit('receive_chat', { sender: '📢 시스템', msg: `${socket.nickname}님이 퇴장하셨습니다.` });
            
            // 방에 아무도 안 남으면 방 폭파
            if (room.users.length === 0) delete rooms[socket.room];
            sendRoomList();
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`서버 실행됨: ${PORT}`));
